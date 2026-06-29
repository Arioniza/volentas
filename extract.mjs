// extract.mjs — das "Gehirn" des Roboters.
// Claude liest das Anfrage-PDF (als Dokument, kein OCR) und gibt die Felder als JSON zurück.
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic(); // liest ANTHROPIC_API_KEY aus der Umgebung

// Striktes Schema: Claude MUSS genau diese Felder liefern (leerer String, wenn unbekannt).
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    kunde: { type: "string", description: "Name der auftraggebenden Firma (z.B. 'Valora Schweiz AG')" },
    kontakt: { type: "string", description: "Ansprechperson, falls vorhanden" },
    strasse: { type: "string", description: "Strasse + Nr. des Objekts/Standorts" },
    plzort: { type: "string", description: "PLZ und Ort des Objekts/Standorts" },
    objekt: { type: "string", description: "Bezeichnung des Standorts/Objekts (z.B. 'kk Kiosk Bhf Maienfeld' oder 'BP Tankstelle Heidiland')" },
    leistung: { type: "string", description: "Kurze Beschreibung der gewünschten Reinigungsarbeit (z.B. 'Grundreinigung', 'Unterhaltsreinigung WC 2x täglich')" },
    auftragsnummer: { type: "string", description: "Auftrags-/Bestellnummer auf dem Formular" },
    referenz: { type: "string", description: "Referenz/Objektnummer, falls separat angegeben" },
    hinweise: { type: "string", description: "Wichtige Hinweise/Bedingungen (z.B. Kostenlimite, Sonderwünsche). KEIN Termin/Datum hier." },
    email: { type: "string", description: "Kontakt-E-Mail, falls vorhanden" },
  },
  required: ["kunde", "kontakt", "strasse", "plzort", "objekt", "leistung", "auftragsnummer", "referenz", "hinweise", "email"],
};

const SYSTEM =
  "Du extrahierst Felder aus einem Schweizer Reinigungs-Anfrage-/Auftragsformular (PDF). " +
  "Gib die Daten exakt nach Schema zurück. Wenn ein Feld nicht im Dokument steht, gib einen leeren String zurück. " +
  "Erfinde KEINE Preise und KEINE Daten, die nicht im PDF stehen. Behalte Original-Schreibweise (auch Abkürzungen wie 'kk', 'BHF').";

// pdfBase64: reiner Base64-String (ohne data:-Präfix)
export async function extractFromPdf(pdfBase64) {
  const res = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1500,
    // Datenschutz: Claude trainiert nicht auf API-Daten. EU-Datenresidenz folgt später beim SaaS-Schritt.
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
          },
          { type: "text", text: "Lies dieses Reinigungs-Anfrageformular und extrahiere die Felder nach Schema." },
        ],
      },
    ],
  });
  const block = res.content.find((b) => b.type === "text");
  if (!block) throw new Error("Keine Textantwort von Claude erhalten.");
  return JSON.parse(block.text);
}

// Baut aus den extrahierten Feldern den Offerten-/Anfrage-Datensatz exakt im Format der App (oErstellen).
// Vorgaben des Users: status='anfrage', Preis 0 (Onkel setzt ihn), gueltig leer, KEIN "Termin bis" in der Bemerkung.
export function buildAnfrage(fields, id, datumDDMMYYYY) {
  const bemerkParts = [];
  if (fields.auftragsnummer) bemerkParts.push("Auftrags-Nr.: " + fields.auftragsnummer);
  if (fields.referenz) bemerkParts.push("Referenz: " + fields.referenz);
  if (fields.hinweise) bemerkParts.push(fields.hinweise);
  const leistung = fields.leistung || "Reinigungsarbeiten";
  return {
    id,
    kunde: fields.kunde || "",
    kontakt: fields.kontakt || "",
    strasse: fields.strasse || "",
    plzort: fields.plzort || "",
    objekt: fields.objekt || "",
    email: fields.email || "",
    datum: datumDDMMYYYY,
    gueltig: "",
    ausf: "",
    bemerk: bemerkParts.join(" · "),
    sub: 0,
    tot: 0,
    status: "anfrage",
    pos: [{ desc: leistung, me: "", ansatz: 0, betrag: 0 }],
  };
}
