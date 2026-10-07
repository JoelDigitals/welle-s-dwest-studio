import { ensureSchema, getDb } from "./db";
import type { StationReport } from "./fetch-station-traffic";

/**
 * Abgleich der Blitzer/Verkehrsmeldungen von Radio Salü und RPR1 mit der eigenen Datenbank:
 * neue Meldungen werden eingefügt, bekannte behalten ihren ersten Zeitpunkt, und alles, was die
 * Quelle nicht mehr führt, wird gelöscht – so spiegelt der Sender immer den aktuellen Stand.
 */
export type StoredStationReport = Omit<StationReport, "reportedAt"> & {
  reportedAt: number;
  firstSeen: number;
};

export async function syncStationReports(
  source: StationReport["source"],
  items: StationReport[],
): Promise<{ added: number; removed: number }> {
  await ensureSchema();
  const sql = getDb();
  const now = Date.now();
  const before = await sql`SELECT id FROM station_reports WHERE source = ${source}`;
  const known = new Set(before.map((r) => String(r.id)));
  const ids = [...new Set(items.map((i) => i.id))];
  for (const item of items) {
    await sql`
      INSERT INTO station_reports (id, source, type, region, road, title, reported_at, first_seen, last_seen)
      VALUES (${item.id}, ${source}, ${item.type}, ${item.region}, ${item.road}, ${item.title},
              ${item.reportedAt ?? now}, ${now}, ${now})
      ON CONFLICT (id) DO UPDATE SET last_seen = ${now}, title = EXCLUDED.title,
        reported_at = CASE WHEN ${item.reportedAt === null} THEN station_reports.reported_at
                           ELSE EXCLUDED.reported_at END
    `;
  }
  const removed = ids.length
    ? await sql`DELETE FROM station_reports WHERE source = ${source} AND id <> ALL(${ids}) RETURNING id`
    : await sql`DELETE FROM station_reports WHERE source = ${source} RETURNING id`;
  return { added: ids.filter((id) => !known.has(id)).length, removed: removed.length };
}

export async function listStationReports(): Promise<StoredStationReport[]> {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`SELECT * FROM station_reports ORDER BY reported_at DESC`;
  return rows.map((r) => ({
    id: String(r.id),
    source: r.source as StationReport["source"],
    type: r.type as StationReport["type"],
    region: r.region as StationReport["region"],
    road: String(r.road ?? ""),
    title: String(r.title),
    reportedAt: Number(r.reported_at),
    firstSeen: Number(r.first_seen),
  }));
}
