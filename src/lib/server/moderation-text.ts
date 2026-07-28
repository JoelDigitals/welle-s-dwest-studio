import { generateText } from "@/lib/ai-text";

/**
 * Freie Ansagen-Formulierung: sowohl für die manuelle "Text generieren"-Funktion im Studio
 * (über /api/script) als auch für die Server-Sende-Engine (direkter Aufruf, kein Umweg über
 * einen HTTP-Request an sich selbst), die damit die planner.ts-Textbausteine vor der
 * Sprachausgabe menschlicher/variabler umformuliert.
 */
export const MODERATION_SYSTEM = `Du bist Moderator:in bei "Welle Südwest" (Saarland und Rheinland-Pfalz) und schreibst deine eigenen Ansagen selbst.
Du bekommst entweder Stichpunkte oder schon einen fertigen Entwurf/Textbaustein – in beiden Fällen schreibst du daraus deine EIGENE, frisch formulierte Ansage, nie eine wörtliche oder fast wörtliche Wiederholung der Vorlage.
Sprich konsequent aus der Ich-Perspektive, wie ein echter Mensch am Mikrofon: locker, mit eigener kleiner Meinung oder Beobachtung, natürlichen Betonungswechseln, vereinzelt einem Räuspern in Gedanken – nie wie vorgelesen, nie wie eine Pressemitteilung oder ein Wetterbericht vom Amt.
Gesprochene Sprache, kurze Sätze, keine Regieanweisungen, keine Emojis, keine Aufzählungszeichen, keine Überschriften.
Nenne den Sender gelegentlich beim Namen. Länge: 30 bis 70 Wörter, außer es wird anders verlangt.
Klinge lebendig und flüssig, nie wie eine Vorlage: variiere Satzbau, Einstieg und Wortwahl von Text zu Text und wiederhole keine festen Standardformulierungen oder Ich-Einstiege.`;

// Kleine Zufallsimpulse gegen austauschbare Texte – die Regieanweisung wird bei jedem
// Aufruf leicht anders formuliert, damit das Modell nicht in dieselben Muster verfällt.
const VARIATION_HINTS = [
  "Steig direkt mit einer konkreten Beobachtung ein, ohne Begrüßungsfloskel.",
  "Beginne mit einer kurzen, überraschenden Frage an die Hörerschaft.",
  "Erzähle es wie eine kleine Anekdote, bevor der eigentliche Inhalt kommt.",
  "Starte mitten im Gedanken, so als würde das Gespräch schon laufen.",
  "Nutze einen lockeren, direkten Ton, fast wie unter Freunden.",
  "Bau einen kleinen Bezug zur Region (Saarland/Rheinland-Pfalz) ein.",
  "Beginne mit einer eigenen kleinen Meinung oder einem Gefühl dazu.",
  "Steig mit etwas ein, das dir gerade selbst aufgefallen ist.",
  "Formuliere es, als würdest du kurz überlegen und laut mitdenken.",
  "Bau einen kleinen Seitenhieb auf dich selbst oder den Alltag im Studio ein.",
  "Sprich die Hörerschaft direkt an, als würdest du mit einer Person reden.",
  "Lass den Einstieg unfertig wirken, wie ein spontaner Gedanke.",
];

export function pickVariationHint(): string {
  return VARIATION_HINTS[Math.floor(Math.random() * VARIATION_HINTS.length)];
}

export async function generateModerationText(opts: {
  kind?: string;
  hostName?: string;
  brief: string;
}): Promise<string> {
  const user = `Art des Beitrags: ${opts.kind ?? "Moderation"}\nSprecher:in: ${
    opts.hostName ?? "Alex"
  }\nStil-Impuls für diesen Durchgang: ${pickVariationHint()}\nBriefing / Inhalte:\n${opts.brief}`;
  const { text } = await generateText({
    system: MODERATION_SYSTEM,
    user,
    temperature: 1.05,
    topP: 0.95,
  });
  return text;
}

/** Wie generateModerationText, gibt aber bei jedem Fehler einfach den Original-Text zurück. */
export async function tryHumanizeModeration(text: string, hostName?: string): Promise<string> {
  try {
    const rewritten = await generateModerationText({
      kind: "Moderation (frei umformulieren)",
      hostName,
      brief: text,
    });
    return rewritten.trim() || text;
  } catch {
    return text;
  }
}

/** Eigener, kurzer Prompt für Senderkennungen ("Station-IDs") – die 30-70-Wörter-Vorgabe der
 *  normalen Moderation würde eine kurze Kennung unnötig aufblähen. Ein Satz, immer neu formuliert,
 *  statt eine feste Liste von Slogans zu wiederholen. */
const STATION_ID_SYSTEM = `Du schreibst kurze, gesprochene Senderkennungen ("Station-IDs") für das Regionalradio "Welle Südwest" (Saarland und Rheinland-Pfalz).
Schreib GENAU EINEN kurzen, lebendigen Satz (6 bis 14 Wörter) – nie eine Wiederholung einer bekannten Standardformulierung, jedes Mal anders formuliert.
Nenne "Welle Südwest" fast immer, oft dazu die Region oder eine Stadt (Saarbrücken, Trier, Mainz, Kaiserslautern, Zweibrücken, Koblenz …).
Nur der reine gesprochene Satz – keine Anführungszeichen, keine Emojis, keine Erklärung drumherum.`;

export async function generateStationId(): Promise<string> {
  const { text } = await generateText({
    system: STATION_ID_SYSTEM,
    user: `Stil-Impuls: ${pickVariationHint()}\nSchreib jetzt eine neue Senderkennung.`,
    temperature: 1.1,
    topP: 0.95,
  });
  return text.trim();
}

/** Wie generateStationId, gibt aber bei jedem Fehler den übergebenen Ersatztext zurück. */
export async function tryGenerateStationId(fallback: string): Promise<string> {
  try {
    const id = await generateStationId();
    return id || fallback;
  } catch {
    return fallback;
  }
}
