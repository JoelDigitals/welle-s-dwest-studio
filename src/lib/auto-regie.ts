import type { PlanItem } from "./broadcast-types";

/**
 * Automatische Regie: entscheidet für jeden Übergang selbst, ob und wie lange zwei Elemente sich
 * überlappen – wie ein:e Moderator:in am Pult.
 *  - Song → Ansage: die Ansage beginnt über dem Song-Ausklang (Song wird geduckt).
 *  - Ansage → Song: die Ansage "läuft in die Musik", der Song startet geduckt unter ihrem Ende.
 *  - Song → Jingle: der Jingle startet über dem Ausklang, der Song wird ausgeblendet.
 *  - Jingle → Song: kurzer, sauberer Anschluss.
 * Nie bei Nachrichten, wichtigen Verkehrsmeldungen (Regel 4), amtlichen Warnungen, Werbung,
 * festen Zeitmarken oder dem Live-Mikrofon. Eine von Hand gesetzte Überlappung (overlapSeconds,
 * auch 0) hat Vorrang, solange sie nicht gegen diese Sperren verstößt.
 */

const SPOKEN = new Set(["moderation", "showopener", "slogan", "weather", "traffic"]);

function isSpoken(item: PlanItem) {
  return SPOKEN.has(item.kind) && !item.mediaId && !item.streamUrl;
}

/** Darf zwischen diesen beiden Elementen überhaupt überlappt werden? */
export function overlapForbidden(prev: PlanItem | undefined, next: PlanItem): string | null {
  if (next.hardStart) return "Feste Zeitmarke";
  for (const item of [prev, next]) {
    if (!item) continue;
    if (item.kind === "news") return "Nachrichten laufen ohne Musik";
    if (item.civilWarning) return "Amtliche Warnung läuft ohne Musik";
    if (item.trafficJingleAfterAnnouncement) return "Wichtige Verkehrsmeldung: Jingle erst danach";
    if (item.kind === "ad") return "Werbung startet und endet sauber";
    if (item.kind === "mic") return "Live-Mikrofon";
  }
  return null;
}

/** Automatisch gewählte Überlappung in Sekunden (ohne Handeinstellung). */
export function autoOverlapSeconds(prev: PlanItem, next: PlanItem): number {
  if (prev.kind === "music" && next.kind === "jingle") return 1.5;
  if (prev.kind === "music" && isSpoken(next)) {
    // Kurze Ansagen steigen etwas früher ein, längere etwas später – nie mehr als 5 s.
    return next.duration < 15 ? 4 : 3;
  }
  if (isSpoken(prev) && next.kind === "music") {
    // Ansage läuft in die Musik: Song-Intro startet unter dem Ende der Ansage.
    const intro = next.introSeconds ?? 6;
    return Math.round(Math.max(2, Math.min(6, intro, prev.duration * 0.25)) * 2) / 2;
  }
  if (prev.kind === "jingle" && next.kind === "music") return 0.5;
  return 0;
}

/** Tatsächliche Überlappung (Handeinstellung vor Automatik, Sperren vor allem). */
export function effectiveOverlap(prev: PlanItem | undefined, next: PlanItem): number {
  if (!prev || overlapForbidden(prev, next)) return 0;
  if (typeof next.overlapSeconds === "number") return Math.max(0, Math.min(8, next.overlapSeconds));
  return autoOverlapSeconds(prev, next);
}
