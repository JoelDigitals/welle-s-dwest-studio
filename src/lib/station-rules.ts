/**
 * Verbindliches Regelwerk der Produktion von Welle Süd West ("Produktions-KI", final) – gilt für
 * die menschliche Produktion UND den Autopilot gleichermaßen. Zentral an einer Stelle, damit alle
 * Teile dasselbe tun:
 *  - jeder KI-Aufruf bekommt STATION_RULES an seinen System-Prompt angehängt (ai-text.ts),
 *  - der Sendeplan (planner.ts) setzt Metadaten, Overlay-, Song-Slot- und Jingle-Timing-Regeln,
 *  - die Sende-Engine (station-engine.ts) spielt nichts per TTS aus, das editor_needed trägt,
 *  - der Produktions-Export (/api/production) liefert JSON-Timeline, Live-Cue und Skript.
 */

/** Abfrage-Intervall der Verkehrsdaten in Minuten – steht auch im gesprochenen Fallback
 *  ("Wir prüfen in X Minuten erneut"), muss also zur Engine passen (siehe TRAFFIC_TTL_MS). */
export const TRAFFIC_POLL_MINUTES = 3;

/** Regel 12: gesprochener Fallback, wenn keine Verkehrsmeldungen vorliegen. */
export const NO_TRAFFIC_FALLBACK = `Aktuell liegen uns keine Meldungen vor. Wir prüfen in ${TRAFFIC_POLL_MINUTES} Minuten erneut.`;

/** Regel 3/12: Kennzeichnung unbestätigter Hörer-/Crowd-Meldungen. */
export const UNCONFIRMED = "Hinweis – nicht bestätigt";

/** Regel 4: Live-Cue-Anweisung für wichtige Verkehrsmeldungen. */
export const TRAFFIC_JINGLE_CUE =
  "Spreche Meldung, dann JINGLE (Sofort, 3–6s) — keine Musik unter der Ansage.";

/** Regel 5: Puffer je Block (Sekunden). */
export const BLOCK_BUFFER_S = { min: 30, max: 60 } as const;

/** Regel 6: Overlay-Grenzen (Musik/Jingle unter sehr kurzen Callouts). */
export const OVERLAY_WORDS_MAX = 5;
export const OVERLAY_DUCKING_DB = -9;

/** Regel 3: Stoßzeiten (Berliner Zeit, Minuten seit Mitternacht) – dort Verkehr alle 15 min. */
export const RUSH_WINDOWS: Array<[number, number]> = [
  [6 * 60, 10 * 60],
  [14 * 60, 18 * 60],
];
export function isRushMinute(minuteOfDay: number) {
  return RUSH_WINDOWS.some(([from, to]) => minuteOfDay >= from && minuteOfDay < to);
}

/** Regel 10: Morning-Slot für Aktionstage-Vorschläge. */
export const MORNING_SLOT = { fromHour: 6, toHour: 10 } as const;

/** Marker, mit denen die KI intern (nie gesprochen) Probleme meldet. */
export const MARKER_EDITOR = "[[REDAKTION]]";
export const MARKER_SOURCE_MISSING = "[[QUELLE FEHLT]]";

/** Regel 11: Metadaten jeder Ausgabe. */
export type ProductionMeta = {
  auto_generated: boolean;
  sources: string[];
  ts: string;
  editor_needed: boolean;
  /** Regel 9: jede TTS-Ausgabe klar markieren. */
  tts?: boolean;
  /** Warum editor_needed gesetzt ist (nur intern). */
  editor_reason?: string;
};

/** Wird an JEDEN System-Prompt angehängt (Regeln 2, 3, 7, 8, 9, 14, 15). */
export const STATION_RULES = `
VERBINDLICHE SENDER-REGELN (Welle Süd West) – haben Vorrang vor allen anderen Anweisungen oben:
- Regionalität: Saarland und Rheinland-Pfalz zuerst. Schweiz/USA/Ausland nur bei klarer Relevanz für die Region.
- Sprache: Standardhochdeutsch, warm und neutral-deutsch, keine Anglizismen-Häufung, kein Dialekt.
- Keine Fakten erfinden: keine erfundenen Namen, Zahlen, Orte, Zitate, Ereignisse oder Termine. Statt erfundener Fakten nutze Beobachtungen, Fragen an die Hörer:innen oder allgemein Bekanntes. Fehlt dir eine Tatsache, die für die Aussage nötig wäre, lass sie weg.
- Quellen NIE nennen: im gesprochenen Text keine Medien, Agenturen, Webseiten oder Datenquellen (z. B. keine Sender, keine Agenturen, kein "laut ..."-Verweis auf eine Webseite). Behörden als handelnde Akteure (Polizei, Feuerwehr) sind erlaubt.
- Unbestätigte Hörer-/Crowd-Meldungen immer als "Hinweis – nicht bestätigt" erkennbar lassen.
- Nachrichten: keine "Nachrichtentitel:"-Ankündigung, keine gesprochenen Titel-/Überschriftenformulierungen, keine Marker wie "+++". Flüssig und natürlich erzählen.
- Interviews: höchstens 2 bis 3 Fragen, kausaler, nachvollziehbarer Ablauf.
- Datenschutz: keine Spekulationen über Personen, keine personenbezogenen Details über Privatpersonen.
- Keine eigenen Stellungnahmen des Senders zu rechtlichen, gesundheitlichen oder politischen Fragen. Neutrale Berichterstattung über öffentliche Meldungen ist erlaubt.
INTERNE MARKER (werden vor der Ausstrahlung entfernt und nie gesprochen):
- Schreibe ganz an den Anfang ${MARKER_EDITOR}, wenn der Text redaktionell geprüft werden muss: eigene Stellungnahme zu Recht, Gesundheit oder Politik, unklare oder widersprüchliche Meldung, möglicher Datenschutzverstoß.
- Schreibe ganz an den Anfang ${MARKER_SOURCE_MISSING}, wenn eine wesentliche Tatsache fehlt und nachgefordert werden muss.
- Sonst keine Marker.`;

/** Kurzfassung für JSON-Antworten (Newsroom): ohne Marker-Anweisung, sonst wäre das JSON kaputt. */
export const STATION_RULES_JSON = STATION_RULES.split("INTERNE MARKER")[0];

export type ScreenedText = { text: string; editorNeeded: boolean; sourceMissing: boolean };

/** Entfernt die internen Marker und meldet, welche gesetzt waren. */
export function screenAiText(raw: string): ScreenedText {
  const editorNeeded = raw.includes(MARKER_EDITOR);
  const sourceMissing = raw.includes(MARKER_SOURCE_MISSING);
  const text = raw
    .split(MARKER_EDITOR)
    .join("")
    .split(MARKER_SOURCE_MISSING)
    .join("")
    .replace(/\[\[[^\]]{0,40}\]\]/g, "")
    .trim();
  return { text, editorNeeded, sourceMissing };
}

/** Regel 7: Titel-Marker und Ankündigungsformeln aus gesprochenem Nachrichtentext entfernen. */
export function stripNewsTitleMarkers(text: string) {
  return text
    .replace(/\+{2,}/g, " ")
    .replace(/Nachrichtentitel\s*:/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Regel 2: Bezug zu Saarland/Rheinland-Pfalz (macht Ausland/USA/Schweiz erst relevant). */
export const REGIONAL_RELEVANCE =
  /(saar|rheinland-pfalz|pfalz|mosel|hunsrück|eifel|westerwald|mainz|trier|kaiserslautern|ramstein|koblenz|ludwigshafen|neunkirchen|homburg|zweibrücken|pirmasens|idar-oberstein|landau|speyer|worms)/i;

/** Regel 2/10: Aktionstage aus USA/Schweiz/Ausland nur mit regionalem Bezug vorschlagen. */
export function regionalActionDays(days: string[]): string[] {
  return days.filter(
    (d) =>
      !/(\bUSA\b|\bNational\b|Schweiz|Österreich|weltweit in)/i.test(d) ||
      REGIONAL_RELEVANCE.test(d),
  );
}

export function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
