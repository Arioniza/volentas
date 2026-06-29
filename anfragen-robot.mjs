// anfragen-robot.mjs — der vollständige Roboter.
// Ablauf: verbindet sich mit dem Postfach (IMAP) -> liest neue Mails im Ordner "Anfragen"
// -> für jedes PDF lässt Claude die Felder auslesen -> legt einen Anfrage-Entwurf in Supabase an
// -> markiert die Mail als gelesen (damit sie nicht doppelt verarbeitet wird).
// Das Roh-PDF wird NIE auf Festplatte gespeichert (Datenschutz / revDSG).

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { extractFromPdf, buildAnfrage } from "./extract.mjs";

const {
  MAIL_HOST = "mail.volentas.ch",
  MAIL_PORT = "993",
  MAIL_USER,
  MAIL_PASS,
  MAIL_FOLDER = "Anfragen",
  SUPABASE_URL = "https://xxqukwlwmdomgftumbal.supabase.co",
  SUPABASE_SERVICE_KEY,
} = process.env;

function need(name, val) {
  if (!val) { console.error("FEHLER: Geheimnis " + name + " fehlt."); process.exit(1); }
}
need("MAIL_USER", MAIL_USER);
need("MAIL_PASS", MAIL_PASS);
need("SUPABASE_SERVICE_KEY", SUPABASE_SERVICE_KEY);
need("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY);

function heute() {
  const d = new Date();
  return String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + d.getFullYear();
}

// Nächste Offerten-Nummer ermitteln (gleiches Schema wie die App: "OF-YYMMxxxx")
async function naechsteBasisNummer() {
  const d = new Date();
  const pre = "OF-" + d.getFullYear().toString().slice(2) + String(d.getMonth() + 1).padStart(2, "0");
  const url = SUPABASE_URL + "/rest/v1/offerten?select=id&id=like." + encodeURIComponent(pre + "*");
  const r = await fetch(url, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_KEY } });
  let max = 0;
  if (r.ok) {
    const rows = await r.json();
    for (const row of rows) {
      const s = String(row.id || "");
      if (s.indexOf(pre) === 0) {
        const n = parseInt(s.slice(pre.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    }
  }
  return { pre, max };
}

async function speichern(off) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/offerten", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: "Bearer " + SUPABASE_SERVICE_KEY,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(off),
  });
  if (!r.ok) throw new Error("Supabase " + r.status + ": " + (await r.text()));
}

async function main() {
  const client = new ImapFlow({
    host: MAIL_HOST,
    port: parseInt(MAIL_PORT, 10),
    secure: true,
    auth: { user: MAIL_USER, pass: MAIL_PASS },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock(MAIL_FOLDER);
  let neu = 0, fehler = 0;
  try {
    const { pre, max } = await naechsteBasisNummer();
    let zaehler = max;

    // Nur ungelesene Mails verarbeiten
    const uids = await client.search({ seen: false }, { uid: true });
    if (!uids || uids.length === 0) {
      console.log("Keine neuen Anfragen im Ordner '" + MAIL_FOLDER + "'.");
      return;
    }
    console.log(uids.length + " neue Mail(s) gefunden.");

    for (const uid of uids) {
      const { content } = await client.download(uid, undefined, { uid: true });
      const chunks = [];
      for await (const c of content) chunks.push(c);
      const parsed = await simpleParser(Buffer.concat(chunks));

      const pdfs = (parsed.attachments || []).filter(
        (a) => (a.contentType === "application/pdf") || /\.pdf$/i.test(a.filename || "")
      );
      if (pdfs.length === 0) {
        console.log("  Mail ohne PDF übersprungen: " + (parsed.subject || "(kein Betreff)"));
        await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        continue;
      }

      for (const pdf of pdfs) {
        try {
          const fields = await extractFromPdf(pdf.content.toString("base64"));
          if (!fields.kunde && !fields.objekt) {
            console.log("  PDF sah nicht nach Anfrage aus, übersprungen: " + (pdf.filename || ""));
            continue;
          }
          zaehler += 1;
          const id = pre + String(zaehler).padStart(4, "0");
          await speichern(buildAnfrage(fields, id, heute()));
          neu += 1;
          console.log("  ✓ Anfrage " + id + " angelegt — " + fields.kunde + " / " + fields.objekt);
        } catch (e) {
          fehler += 1;
          console.error("  ✗ Fehler bei PDF " + (pdf.filename || "") + ": " + e.message);
        }
      }
      // Mail als gelesen markieren -> wird beim nächsten Lauf nicht erneut verarbeitet
      await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
    }
  } finally {
    lock.release();
    await client.logout();
  }
  console.log("Fertig. " + neu + " Anfrage(n) angelegt, " + fehler + " Fehler.");
  if (fehler > 0) process.exit(1);
}

main().catch((e) => { console.error("Roboter abgestürzt:", e.message); process.exit(1); });
