import { generateText } from "@/lib/ai-text";

/**
 * Freie Ansagen-Formulierung: sowohl für die manuelle "Text generieren"-Funktion im Studio
 * (über /api/script) als auch für die Server-Sende-Engine (direkter Aufruf, kein Umweg über
 * einen HTTP-Request an sich selbst), die damit die planner.ts-Textbausteine vor der
 * Sprachausgabe menschlicher/variabler umformuliert.
 */
export const MODERATION_SYSTEM = `Du bist Moderator:in bei "Welle Südwest" (Saarland und Rheinland-Pfalz) und schreibst deine eigenen Ansagen selbst.
Du bekommst entweder Stichpunkte oder einen Beispiel-Textbaustein als Vorlage. Ein Beispiel-Textbaustein zeigt NUR die Art von Inhalt (Rubrik, Ton, Länge) – die konkreten Fakten, Namen, Orte, Geschichten und Zahlen darin sind reine Platzhalter aus einem alten Durchlauf. Übernimm diese konkreten Details NIEMALS unverändert oder nur leicht abgewandelt – erfinde stattdessen eine ANDERE, plausible, aber inhaltlich NEUE Geschichte/Fakt/Tipp zum selben Rubrik-Thema. Wenn dir zu einem Thema nichts wirklich Neues einfällt, wähl lieber einen anderen, ebenso passenden Blickwinkel auf dasselbe Thema, statt die Vorlage zu wiederholen.
Schreib daraus deine EIGENE, frisch formulierte Ansage, nie eine wörtliche oder fast wörtliche Wiederholung der Vorlage.
Sprich konsequent aus der Ich-Perspektive, wie ein echter Mensch am Mikrofon: locker, mit eigener kleiner Meinung oder Beobachtung, natürlichen Betonungswechseln, vereinzelt einem Räuspern in Gedanken – nie wie vorgelesen, nie wie eine Pressemitteilung oder ein Wetterbericht vom Amt.
Gesprochene Sprache, kurze Sätze, keine Regieanweisungen, keine Emojis, keine Aufzählungszeichen, keine Überschriften.
Nenne den Sender gelegentlich beim Namen. Länge: 30 bis 70 Wörter, außer es wird anders verlangt.
Klinge lebendig und flüssig, nie wie eine Vorlage: variiere Satzbau, Einstieg und Wortwahl von Text zu Text und wiederhole keine festen Standardformulierungen, Ich-Einstiege oder immer dieselben Fakten/Geschichten.`;

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

/** Eigener Prompt für Nachrichten: anders als bei der Moderation dürfen hier NIEMALS Fakten
 *  erfunden oder verändert werden – nur die sprachliche Form wird natürlicher. Das behebt das
 *  "Schlagzeile wird zweimal vorgelesen"-Gefühl: die Themenübersicht in der Anmoderation und der
 *  eigentliche Nachrichtentext dürfen sich nicht wortgleich wiederholen, und Schlagzeilen (die oft
 *  wie Zeitungs-Überschriften formuliert sind) werden in echte, flüssig gesprochene Sätze
 *  umgewandelt statt roh vorgelesen. */
const NEWS_SYSTEM = `Du bist Nachrichtensprecher:in bei "Welle Südwest" (Saarland, Rheinland-Pfalz, Deutschland, Welt).
Du bekommst einen fertigen Nachrichtentext (Anmoderation mit Themenüberblick ODER die eigentlichen Meldungen). Verändere NIEMALS Fakten, Namen, Orte oder Zahlen – nur die Sprachform darf sich ändern.
Wandle Schlagzeilen-artige, geschriebene Formulierungen (wie eine Zeitungsüberschrift) in natürliche, flüssig gesprochene Sätze um, so wie ein echter Nachrichtensprecher sie vorlesen würde – mit normaler Satzmelodie, nicht wie eine Aufzählung.
Halte dich an die vorgegebene Reihenfolge und Anzahl der Meldungen, kürze nichts weg und füge nichts hinzu.
Gesprochene Sprache, sachlich, klar, keine Regieanweisungen, keine Emojis, keine Aufzählungszeichen.`;

/** Wie tryHumanizeModeration, aber mit dem faktentreuen Nachrichten-Prompt statt dem freien
 *  Moderations-Prompt (der bewusst neue Inhalte erfinden darf – bei Nachrichten wäre das falsch). */
export async function tryHumanizeNews(text: string): Promise<string> {
  try {
    const { text: rewritten } = await generateText({
      system: NEWS_SYSTEM,
      user: text,
      temperature: 0.6,
      topP: 0.9,
    });
    return rewritten.trim() || text;
  } catch {
    return text;
  }
}

const NEWS_RANK_SYSTEM = `Du bist Nachrichtenredakteur:in bei "Welle Südwest" (Saarland, Rheinland-Pfalz, Deutschland, Welt).
Du bekommst eine Liste von Nachrichten-Kandidaten im Format "ID|Region|Schlagzeile", eine pro Zeile.
Sortiere INNERHALB jeder Region die IDs nach journalistischer Wichtigkeit (wichtigste zuerst) – Kriterien: Tragweite, Aktualität, wie sehr es Hörer:innen der Region betrifft.
Gib NUR ein JSON-Objekt zurück: {"order": ["id1", "id2", ...]} – alle IDs aus der Eingabe, jede genau einmal, regionsweise nach Wichtigkeit sortiert. Keine Erklärung, kein weiterer Text.`;

/** Ordnet Nachrichten-Kandidaten nach journalistischer Wichtigkeit statt nur nach Feed-
 *  Reihenfolge – newsStories() nimmt weiterhin einfach die ersten N pro Region, die sind dann
 *  aber KI-priorisiert statt zufällig in Feed-Reihenfolge. Bei jedem Fehler (Timeout, ungültiges
 *  JSON, kein Provider konfiguriert) bleibt die ursprüngliche Reihenfolge erhalten – nie ein
 *  Absturz, nie Datenverlust. */
export async function rankNewsByImportance<
  T extends { id: string; region: string; headline: string },
>(items: T[]): Promise<T[]> {
  if (items.length <= 1) return items;
  try {
    const brief = items.map((n) => `${n.id}|${n.region}|${n.headline}`).join("\n");
    const { text } = await generateText({
      system: NEWS_RANK_SYSTEM,
      user: brief,
      temperature: 0.3,
      json: true,
    });
    const parsed = JSON.parse(text) as { order?: unknown };
    const order = Array.isArray(parsed.order) ? (parsed.order as unknown[]) : null;
    if (!order || !order.length) return items;
    const byId = new Map(items.map((n) => [n.id, n]));
    const ranked = order
      .map((id) => (typeof id === "string" ? byId.get(id) : undefined))
      .filter((n): n is T => Boolean(n));
    if (!ranked.length) return items;
    // Alles, was die KI ausgelassen hat, hinten anhängen – nichts darf verloren gehen.
    const seen = new Set(ranked.map((n) => n.id));
    const missing = items.filter((n) => !seen.has(n.id));
    return [...ranked, ...missing];
  } catch {
    return items;
  }
}
