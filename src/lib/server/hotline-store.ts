import type { HotlineReportType } from "@/lib/broadcast-types";

export type HotlineReport = {
  id: string;
  type: HotlineReportType;
  region: "Saarland" | "Rheinland-Pfalz";
  place: string;
  road: string;
  message: string;
  caller: string;
  contact: string;
  createdAt: number;
};

/**
 * Serverseitiger Speicher für Hörer-Hotline-Meldungen. Einziges Modul, das
 * globalThis.__hotline anfasst – Route-Handler und Server-Sende-Engine lesen/schreiben
 * ausschließlich über diese Funktionen.
 */
const store = globalThis as unknown as { __hotline?: HotlineReport[]; __hotlineAnnounced?: Set<string> };
store.__hotline ??= [];
// Merkt sich, welche Meldungen der Autopilot bereits automatisch vorgelesen hat (siehe
// pushHotlineMix in planner.ts) – ohne das würde dieselbe Meldung (Gruß, Musikwunsch, Lob &
// Kritik, Sonstiges) stundenlang wiederholt vorgelesen, solange sie noch als "frisch" gilt.
store.__hotlineAnnounced ??= new Set();

export function listHotlineReports(): HotlineReport[] {
  return store.__hotline ?? [];
}

export function addHotlineReport(report: HotlineReport) {
  store.__hotline = [report, ...listHotlineReports()].slice(0, 200);
  return report;
}

export function isHotlineAnnounced(id: string): boolean {
  return store.__hotlineAnnounced?.has(id) ?? false;
}

export function listAnnouncedHotlineIds(): string[] {
  return [...(store.__hotlineAnnounced ?? [])];
}

export function markHotlineAnnounced(ids: string[]) {
  const set = store.__hotlineAnnounced ?? new Set();
  for (const id of ids) set.add(id);
  store.__hotlineAnnounced = set;
}
