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
const store = globalThis as unknown as { __hotline?: HotlineReport[] };
store.__hotline ??= [];

export function listHotlineReports(): HotlineReport[] {
  return store.__hotline ?? [];
}

export function addHotlineReport(report: HotlineReport) {
  store.__hotline = [report, ...listHotlineReports()].slice(0, 200);
  return report;
}
