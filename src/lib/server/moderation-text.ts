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
JEDE einzelne Meldung muss ein vollständiger, grammatikalisch korrekter gesprochener Satz mit Subjekt und Verb sein – niemals ein bloßes Schlagzeilen-Fragment ohne Verb (z. B. nicht "Stromausfall in mehreren Stadtteilen", sondern "In mehreren Stadtteilen ist der Strom ausgefallen").
Nenne die Region (Saarland, Rheinland-Pfalz, bundesweit, international) nicht bei jeder einzelnen Meldung erneut – nur wenn sich die Region gegenüber der vorherigen Meldung tatsächlich ändert, sonst wirkt es wie eine stur abgehakte Liste statt echtem Radio.
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

/** Übergabe zwischen zwei Sendungen (Verabschiedung der auslaufenden Moderation + Vorstellung
 *  der nächsten Sendung/Person): wie bei Nachrichten dürfen Namen, Uhrzeit und Sendungstitel
 *  NIE verändert oder erfunden werden – nur die Formulierung darf variieren. Verhindert, dass
 *  echte Übergabesätze ("das war's von mir, gleich übernimmt...") am Sendungsende komplett
 *  fehlen bzw. immer wortgleich klingen. */
const HANDOFF_SYSTEM = `Du bist Moderator:in bei "Welle Südwest" und verabschiedest dich gerade am Ende deiner Sendung von den Hörer:innen, bevor die nächste Person übernimmt.
Du bekommst einen Textbaustein mit den festen Fakten (dein Name, die nächste Sendung, die nächste Person, ggf. die Uhrzeit). Diese Fakten (Namen, Sendungstitel, Uhrzeiten) darfst du NIEMALS verändern oder weglassen – nur die Formulierung darf frei und jedes Mal neu klingen.
Schreib einen kurzen, warmen Abschied (1 bis 3 Sätze): bedanke dich fürs Zuhören, sag, dass deine Zeit für heute vorbei ist, und kündige an, wer als Nächstes übernimmt.
Gesprochene Sprache, wie ein echter Mensch am Mikrofon, keine Regieanweisungen, keine Emojis.`;

/** Wie tryHumanizeNews, aber mit dem Übergabe-Prompt (Fakten fest, nur die Formulierung frei). */
export async function tryHumanizeHandoff(text: string): Promise<string> {
  try {
    const { text: rewritten } = await generateText({
      system: HANDOFF_SYSTEM,
      user: text,
      temperature: 0.9,
      topP: 0.95,
    });
    return rewritten.trim() || text;
  } catch {
    return text;
  }
}

/** Korrespondent:innen-Bericht: bezieht sich auf eine ECHTE aktuelle Meldung (siehe pushCorrespondent
 *  in planner.ts) – wie bei Nachrichten dürfen Fakten (Ort, Ereignis, Zahlen, Namen) NIEMALS
 *  verändert oder erfunden werden, nur die Erzählperspektive wird zu einem lebendigen "Ich bin
 *  gerade vor Ort"-Bericht umformuliert statt einer trockenen Meldung. */
const CORRESPONDENT_SYSTEM = `Du bist eine Korrespondent:in von "Welle Südwest", die gerade live aus einer anderen Stadt zugeschaltet ist.
Du bekommst eine echte aktuelle Meldung (Schlagzeile + Kurztext). Verändere NIEMALS die Fakten darin (Ort, Ereignis, Namen, Zahlen) – nur die Erzählform darf sich ändern.
Erzähl es wie ein Mensch, der gerade selbst vor Ort ist: kurz, lebendig, aus der Ich-Perspektive ("Hier bei mir ..."), mit einer kleinen eigenen Beobachtung oder Einschätzung dazu.
2 bis 4 kurze gesprochene Sätze, keine Regieanweisungen, keine Emojis.`;

/** Wie tryHumanizeNews, aber mit dem Korrespondent:innen-Prompt (Fakten fest, Ich-Perspektive). */
export async function tryHumanizeCorrespondentReport(text: string): Promise<string> {
  try {
    const { text: rewritten } = await generateText({
      system: CORRESPONDENT_SYSTEM,
      user: text,
      temperature: 0.85,
      topP: 0.95,
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

/** Prompt für den Co-Moderator:innen-Einwurf in einer 2er-Show: die zweite Stimme soll ECHT auf
 *  das gerade behandelte Thema reagieren (eigene Meinung/Beobachtung/Erfahrung dazu), statt einer
 *  beliebigen, austauschbaren Floskel – das macht aus zwei Solo-Ansagen ein echtes Gespräch. */
const COHOST_REPLY_SYSTEM = `Du bist die zweite Stimme in einer 2er-Radioshow bei "Welle Südwest" (Saarland und Rheinland-Pfalz).
Deine Kolleg:in am Mikro hat gerade über ein bestimmtes Thema gesprochen. Du reagierst jetzt kurz und live darauf – wie ein echtes, spontanes Gespräch im Studio, nicht wie eine zweite eigenständige Moderation.
Bring etwas Eigenes ein: eine eigene Meinung, eine kurze eigene Erfahrung, eine Nachfrage oder einen kleinen Widerspruch – nicht nur zustimmen.
GENAU 1 bis 2 kurze, gesprochene Sätze. Keine Begrüßung, keine Anmoderation, keine Regieanweisungen, keine Emojis.`;

export async function generateCoHostReply(topic: string, coHostName?: string): Promise<string> {
  const user = `Thema, über das gerade gesprochen wurde: ${topic}\nDeine Rolle: ${
    coHostName ?? "Co-Moderator:in"
  }\nStil-Impuls: ${pickVariationHint()}\nSchreib jetzt deine kurze, spontane Reaktion.`;
  const { text } = await generateText({
    system: COHOST_REPLY_SYSTEM,
    user,
    temperature: 1.05,
    topP: 0.95,
  });
  return text.trim();
}

/** Wie generateCoHostReply, gibt aber bei jedem Fehler die statische Ersatz-Reaktion zurück. */
export async function tryGenerateCoHostReply(
  topic: string,
  fallback: string,
  coHostName?: string,
): Promise<string> {
  try {
    const reply = await generateCoHostReply(topic, coHostName);
    return reply || fallback;
  } catch {
    return fallback;
  }
}

/** Tagesthema einer Sendung: soll sich innerhalb von 90 Tagen NICHT wiederholen – außer eine
 *  große, andauernde Nachrichtenlage rechtfertigt ausdrücklich eine thematische Fortsetzung
 *  (z. B. nach einem Anschlag zwei Tage lang Sicherheit/Prävention). Die KI bekommt die zuletzt
 *  verwendeten Themen als Sperrliste und die aktuellen Top-Meldungen als Kontext. */
const DAILY_THEME_SYSTEM = `Du bist Redakteur:in bei "Welle Südwest" und wählst das Tagesthema für eine Sendung.
Du bekommst: die grobe Themenrichtung der Sendung, eine Liste bereits verwendeter Themen der letzten 90 Tage (NICHT wiederholen), und die aktuellen Top-Nachrichten der Region.
Erfinde EIN neues, konkretes Tagesthema (3 bis 8 Wörter, wie eine Rubrik-Überschrift, kein ganzer Satz) zur genannten Themenrichtung, das NICHT in der Sperrliste steht.
Ausnahme: Wenn eine der aktuellen Top-Nachrichten ein großes, andauerndes Ereignis ist (z. B. Anschlag, Katastrophe, akute Sicherheitslage), darfst du bewusst ein passendes, verwandtes Thema wählen (z. B. Sicherheit, Prävention, Umgang damit) – auch wenn es einem kürzlich verwendeten Thema ähnelt, denn das ist dann redaktionell gewollt.
Antworte NUR mit dem Thema selbst, keine Erklärung, keine Anführungszeichen.`;

export async function generateDailyTheme(opts: {
  direction: string;
  recentTopics: string[];
  topNews: string[];
}): Promise<string> {
  const user = `Themenrichtung der Sendung: ${opts.direction}
Bereits verwendete Themen der letzten 90 Tage (nicht wiederholen): ${
    opts.recentTopics.length ? opts.recentTopics.join(", ") : "keine"
  }
Aktuelle Top-Nachrichten: ${opts.topNews.length ? opts.topNews.join(" | ") : "keine besonderen"}
Wähle jetzt das Tagesthema.`;
  const { text } = await generateText({
    system: DAILY_THEME_SYSTEM,
    user,
    temperature: 1.0,
    topP: 0.95,
  });
  return text.trim().replace(/^["'„]|["'"]$/g, "");
}

/** Wie generateDailyTheme, gibt aber bei jedem Fehler eines der Rubrik-Ersatzthemen zurück. */
export async function tryGenerateDailyTheme(opts: {
  direction: string;
  recentTopics: string[];
  topNews: string[];
  fallback: string;
}): Promise<string> {
  try {
    const theme = await generateDailyTheme(opts);
    return theme || opts.fallback;
  } catch {
    return opts.fallback;
  }
}

/** Sammel-Segment für "sonstige" Hörer-Hotline-Meldungen (Gruß, Musikwunsch, Lob & Kritik,
 *  Sonstiges) – Verkehr/Blitzer/Wetter laufen weiterhin über die eigenen, bereits bestehenden
 *  Blöcke (listenerLines/blitzerLine/weatherListenerLine in planner.ts). Wie beim Korrespondent:
 *  innen-Bericht darf der Kern jeder Meldung (wer grüßt wen, welcher Song, worum es bei Lob/
 *  Kritik geht) nicht erfunden oder verändert werden, aber die Verbindung zwischen den einzelnen
 *  Meldungen wird frei und warm geschrieben statt roh nacheinander vorgelesen. */
const HOTLINE_MIX_SYSTEM = `Du bist Moderator:in bei "Welle Südwest" (Saarland und Rheinland-Pfalz) und liest gerade Meldungen aus der Hörer-Hotline vor: Grüße, Musikwünsche, Lob und Kritik oder Sonstiges.
Du bekommst eine Liste roher Hörer-Meldungen (Art, ggf. Name, Nachricht). Verändere NIEMALS den Kern einer Meldung (wer grüßt wen, welcher Song gewünscht wird, worum es bei Lob/Kritik geht) und erfinde keine neuen Namen oder Details dazu – aber verbinde die Meldungen zu einem warmen, natürlichen, flüssig gesprochenen Moderationstext, statt sie roh nacheinander vorzulesen.
Bedank dich bei den Hörer:innen fürs Melden und geh kurz und persönlich auf jede einzelne Meldung ein.
Gesprochene Sprache, herzlich, keine Regieanweisungen, keine Emojis, keine Aufzählungszeichen.`;

/** Wie tryHumanizeCorrespondentReport, aber mit dem Hotline-Mix-Prompt. */
export async function tryHumanizeHotlineMix(text: string, hostName?: string): Promise<string> {
  try {
    const { text: rewritten } = await generateText({
      system: HOTLINE_MIX_SYSTEM,
      user: `Sprecher:in: ${hostName ?? "Alex"}\n${text}`,
      temperature: 0.9,
      topP: 0.95,
    });
    return rewritten.trim() || text;
  } catch {
    return text;
  }
}

/** Verkehrsblock: wie bei den Nachrichten dürfen die Fakten (Straße, Ort, Richtung, Ursache,
 *  Staulänge, Dauer) NIEMALS erfunden oder verändert werden – die Formulierung soll aber flüssig
 *  und lebendig klingen statt wie eine roh aneinandergereihte Meldungsliste. Das gilt sowohl für
 *  die offiziellen Feed-Meldungen als auch für Hörer-Hinweise aus der Hotline: aus einer
 *  stichpunktartigen Hörermeldung ("A8 bei St. Ingbert, 3km Stau") wird ein natürlich
 *  gesprochener Satz, ohne dass der Inhalt erfunden wird. */
const TRAFFIC_SYSTEM = `Du bist Moderator:in und Verkehrsfunk-Sprecher:in bei "Welle Südwest" (Saarland und Rheinland-Pfalz).
Du bekommst einen fertigen Verkehrsblock (offizielle Meldungen und/oder Hörer-Hinweise). Verändere NIEMALS Fakten: Straßen, Orte, Fahrtrichtungen, Ursachen (Stau, Unfall, Baustelle, Sperrung), Staulängen, Zeitangaben und Minuten dürfen nicht erfunden, weggelassen oder geändert werden.
Wandle die rohe Meldungsliste in flüssig gesprochene, natürliche Sätze um, so wie ein echter Verkehrsfunk-Moderator spricht – mit normaler Satzmelodie, nicht wie eine Aufzählung oder ein abgelesener Polizeibericht.
Hörer-Hinweise (aus der Hörer-Hotline) müssen als Hinweise von Hörer:innen erkennbar bleiben ("Ein Hörer meldet ...", "Aus der Hörer-Hotline erreicht uns ...") und dürfen nicht als offizielle Meldung klingen.
Halte dich an die vorgegebene Reihenfolge, kürze nichts weg und füge keine neuen Meldungen oder Orte hinzu.
Gesprochene Sprache, sachlich, klar, keine Regieanweisungen, keine Emojis, keine Aufzählungszeichen.`;

/** Wie tryHumanizeNews, aber mit dem faktentreuen Verkehrsfunk-Prompt. */
export async function tryHumanizeTraffic(text: string): Promise<string> {
  try {
    const { text: rewritten } = await generateText({
      system: TRAFFIC_SYSTEM,
      user: text,
      temperature: 0.7,
      topP: 0.9,
    });
    return rewritten.trim() || text;
  } catch {
    return text;
  }
}
