/**
 * Alle Zeit-basierten Entscheidungen (welche Sendung/Moderator:in gerade läuft, Uhrzeit-Ansagen,
 * Nachtmodus, Nachrichten zur vollen/halben Stunde) müssen sich nach der deutschen Ortszeit
 * richten – unabhängig davon, in welcher Zeitzone der Server tatsächlich läuft. Cloud-Hosting
 * (z. B. Render) läuft standardmäßig in UTC; ohne diese Umrechnung liefen falsche Sendungen zur
 * falschen Zeit und die Moderation nannte eine falsche Uhrzeit (2 Stunden daneben durch
 * UTC↔MESZ-Differenz im Sommer).
 */
const BERLIN_TZ = "Europe/Berlin";

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BERLIN_TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
});

function berlinParts(at: number) {
  const parts = partsFormatter.formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")) - 1,
    date: Number(get("day")),
    // Manche ICU-Implementierungen geben bei hour12:false Mitternacht als "24" statt "00" aus.
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
  };
}

export const berlinHour = (at: number): number => berlinParts(at).hour;
export const berlinMinute = (at: number): number => berlinParts(at).minute;
export const berlinDate = (at: number): number => berlinParts(at).date;
/** "YYYY-MM-DD" in deutscher Ortszeit – als stabiler Tages-Schlüssel für Speicherung (z. B.
 *  Tagesthemen), unabhängig von der Server-Zeitzone. */
export const berlinDateKey = (at: number): string => {
  const p = berlinParts(at);
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.date).padStart(2, "0")}`;
};
export const berlinMonth = (at: number): number => berlinParts(at).month;
export const berlinIsWeekend = (at: number): boolean => {
  const wd = berlinParts(at).weekday;
  return wd === "Sat" || wd === "Sun";
};

/** "HH:MM" in deutscher Ortszeit, unabhängig von der Server-Zeitzone. */
export const berlinClock = (at: number): string =>
  new Date(at).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BERLIN_TZ,
  });
