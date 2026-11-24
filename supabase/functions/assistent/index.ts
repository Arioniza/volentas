// Volentas Text-Assistent (Supabase Edge Function)
//
// Die App schickt Texte hierher; diese Funktion fragt Claude und gibt die Antwort zurueck.
// Der Claude-API-Schluessel liegt nur hier (Supabase-Secret ANTHROPIC_API_KEY) und
// ist im Browser nie sichtbar. Nur angemeldete Volentas-Nutzer duerfen die Funktion aufrufen.

import Anthropic from "npm:@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";
const MAX_TEXT = 6000;      // Zeichen pro Text
const MAX_VERLAUF = 20;     // Nachrichten im Chat

const ERLAUBTE_URSPRUENGE = [
  "https://arioniza.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
];

const FIRMA = `Du arbeitest für die Volentas GmbH, eine Reinigungs- und Facility-Service-Firma in Zürich (Schweiz).
Kunden sind z.B. Valora (k kiosk, Brezelkönig, Caffè Spettacolo, avec), Tankstellen und Läden.
Schreibe Schweizer Hochdeutsch: "ss" statt "ß", Beträge als CHF 1'234.50.`;

const SYSTEM_VERBESSERN = `${FIRMA}

Deine Aufgabe: Verbessere den Text, den der Nutzer schickt, für eine Rechnung, Offerte oder Arbeitsbestätigung.
- Korrigiere Rechtschreibung, Grammatik und Zeichensetzung.
- Formuliere klar, sachlich und professionell, aber nicht aufgebläht.
- Behalte alle Fakten genau bei: Zahlen, Daten, Beträge, Namen, Objektnummern und Orte. Erfinde nichts dazu.
- Antworte nur mit dem verbesserten Text, ohne Einleitung, Erklärung oder Anführungszeichen.`;

const SYSTEM_CHAT = `${FIRMA}

Du hilfst beim Schreiben im Büroalltag: Texte für Rechnungen und Offerten, E-Mails an Kunden,
Mahnungen, kurze Erklärungen. Antworte kurz und direkt auf Deutsch. Wenn du einen Text schreibst,
den man kopieren soll, gib ihn ohne lange Einleitung aus. Erfinde keine Beträge, Daten oder Namen,
die der Nutzer nicht genannt hat; lass dafür eine Lücke wie [Betrag].`;

function cors(origin: string | null): Record<string, string> {
  const o = origin && ERLAUBTE_URSPRUENGE.includes(origin) ? origin : ERLAUBTE_URSPRUENGE[0];
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function antwort(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json" },
  });
}

// Prueft das Login-Token bei Supabase Auth
async function angemeldet(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
  });
  return r.ok;
}

function nurText(s: unknown): string {
  return typeof s === "string" ? s.slice(0, MAX_TEXT) : "";
}

const client = new Anthropic(); // liest ANTHROPIC_API_KEY

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return antwort(405, { fehler: "Nur POST erlaubt." }, origin);
  if (!(await angemeldet(req))) return antwort(401, { fehler: "Bitte zuerst anmelden." }, origin);

  let body: { modus?: string; text?: string; feld?: string; verlauf?: { rolle: string; text: string }[] };
  try {
    body = await req.json();
  } catch {
    return antwort(400, { fehler: "Ungültige Anfrage." }, origin);
  }

  let system: string;
  let messages: Anthropic.Beta.BetaMessageParam[];
  if (body.modus === "verbessern") {
    const text = nurText(body.text).trim();
    if (!text) return antwort(400, { fehler: "Kein Text zum Verbessern." }, origin);
    const feld = nurText(body.feld).slice(0, 80);
    system = SYSTEM_VERBESSERN;
    messages = [{ role: "user", content: (feld ? `Feld: ${feld}\n\n` : "") + text }];
  } else if (body.modus === "chat") {
    const verlauf = Array.isArray(body.verlauf) ? body.verlauf.slice(-MAX_VERLAUF) : [];
    messages = verlauf
      .filter((m) => m && (m.rolle === "nutzer" || m.rolle === "assistent") && nurText(m.text).trim())
      .map((m) => ({ role: m.rolle === "nutzer" ? "user" : "assistant", content: nurText(m.text) }));
    if (!messages.length || messages[0].role !== "user" || messages[messages.length - 1].role !== "user") {
      return antwort(400, { fehler: "Ungültiger Chat-Verlauf." }, origin);
    }
    system = SYSTEM_CHAT;
  } else {
    return antwort(400, { fehler: "Unbekannter Modus." }, origin);
  }

  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system,
      messages,
      output_config: { effort: "low" }, // kurze Bürotexte: schnell und günstig
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // lehnt das Modell ab, springt ein anderes ein
    });
    if (res.stop_reason === "refusal") {
      return antwort(422, { fehler: "Dazu kann der Assistent leider nichts schreiben." }, origin);
    }
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) return antwort(502, { fehler: "Keine Antwort erhalten. Bitte nochmals versuchen." }, origin);
    return antwort(200, { text }, origin);
  } catch (e) {
    console.error("Claude-Fehler:", e);
    if (e instanceof Anthropic.AuthenticationError) {
      return antwort(500, { fehler: "Der Claude-Schlüssel in Supabase fehlt oder ist ungültig." }, origin);
    }
    if (e instanceof Anthropic.RateLimitError) {
      return antwort(429, { fehler: "Gerade zu viele Anfragen. Bitte kurz warten." }, origin);
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return antwort(502, { fehler: "Keine Verbindung zu Claude. Bitte nochmals versuchen." }, origin);
    }
    if (e instanceof Anthropic.APIError && e.status === 402) {
      return antwort(402, { fehler: "Beim Claude-Konto fehlt Guthaben." }, origin);
    }
    return antwort(500, { fehler: "Der Assistent hatte einen Fehler. Bitte nochmals versuchen." }, origin);
  }
});
