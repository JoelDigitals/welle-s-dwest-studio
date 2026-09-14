import type { HotlineReport, HotlineReportType } from "@/lib/broadcast-types";
import { sharesLocation } from "@/lib/planner";
import { ensureSchema, getDb } from "./db";

/**
 * Serverseitiger Speicher für Hörer-Hotline-Meldungen – dauerhaft in Postgres (lag vorher nur in
 * einem flüchtigen globalThis-Array, ging bei jedem Render-Redeploy komplett verloren; eine
 * "Blitzer bleibt 5 Tage sichtbar"-Anforderung war damit technisch unmöglich).
 *
 * Nur die "schon vorgelesen"-Markierung (announced) bleibt bewusst weiterhin nur im Speicher -
 * geht sie bei einem Redeploy verloren, liest der Autopilot höchstens ein, zwei Meldungen einmal
 * erneut vor. Deutlich unkritischer als der komplette Verlust aller Meldungen.
 */

// Obergrenze für die Aufbewahrung - deutlich mehr als die gewünschten 5 Tage für Blitzer auf der
// Website (siehe FRESH_MS in traffic-overview.ts), damit die Website-Anzeige nie an dieser
// Speicher-Grenze hängen bleibt, sondern nur an der dort konfigurierten Sichtbarkeitsdauer.
const RETENTION_MS = 10 * 24 * 3600_000;

const g = globalThis as unknown as { __hotlineAnnounced?: Set<string> };
g.__hotlineAnnounced ??= new Set();

function rowToReport(row: Record<string, unknown>): HotlineReport {
  return {
    id: String(row.id),
    type: row.type as HotlineReportType,
    region: row.region as HotlineReport["region"],
    place: String(row.place ?? ""),
    road: String(row.road ?? ""),
    message: String(row.message ?? ""),
    caller: String(row.caller ?? ""),
    contact: String(row.contact ?? ""),
    createdAt: Number(row.created_at),
  };
}

export async function listHotlineReports(): Promise<HotlineReport[]> {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM hotline_reports ORDER BY created_at DESC LIMIT 500
  `;
  return rows.map((r) => rowToReport(r as unknown as Record<string, unknown>));
}

export async function addHotlineReport(report: HotlineReport): Promise<HotlineReport> {
  await ensureSchema();
  const sql = getDb();
  await sql`
    INSERT INTO hotline_reports (id, type, region, place, road, message, caller, contact, created_at)
    VALUES (
      ${report.id}, ${report.type}, ${report.region}, ${report.place}, ${report.road},
      ${report.message}, ${report.caller}, ${report.contact}, ${report.createdAt}
    )
  `;
  // Beiläufiges Aufräumen statt eines eigenen Cron-Jobs.
  await sql`DELETE FROM hotline_reports WHERE created_at < ${Date.now() - RETENTION_MS}`;
  if (report.type === "entwarnung") {
    await resolveEntwarnung(report);
  }
  return report;
}

/** Eine "Entwarnung" hebt frühere Verkehrs-/Blitzer-Meldungen zur selben Stelle vorzeitig auf -
 *  die werden komplett aus dem System gelöscht (nicht nur ausgeblendet), damit sie weder
 *  vorgelesen noch auf der Website gezeigt werden. Die Entwarnung selbst bleibt stehen und wird
 *  einmal angesagt (siehe pushHotlineMix in planner.ts, das "entwarnung" wie die anderen
 *  Sammel-Meldungstypen behandelt). "Gleiche Stelle" wird wie bei dedupeByLocation über
 *  gemeinsame Orts-/Straßen-Stichwörter erkannt, nicht über exakten Textvergleich. */
async function resolveEntwarnung(entwarnung: HotlineReport): Promise<void> {
  const sql = getDb();
  const candidates = await sql`
    SELECT * FROM hotline_reports
    WHERE type IN ('verkehr', 'blitzer') AND region = ${entwarnung.region} AND id != ${entwarnung.id}
  `;
  const toDelete = candidates
    .map((r) => rowToReport(r as unknown as Record<string, unknown>))
    .filter((r) => sharesLocation(r, entwarnung));
  if (!toDelete.length) return;
  const ids = toDelete.map((r) => r.id);
  await sql`DELETE FROM hotline_reports WHERE id = ANY(${ids})`;
}

export function isHotlineAnnounced(id: string): boolean {
  return g.__hotlineAnnounced?.has(id) ?? false;
}

export function listAnnouncedHotlineIds(): string[] {
  return [...(g.__hotlineAnnounced ?? [])];
}

export function markHotlineAnnounced(ids: string[]) {
  const set = g.__hotlineAnnounced ?? new Set();
  for (const id of ids) set.add(id);
  g.__hotlineAnnounced = set;
}
