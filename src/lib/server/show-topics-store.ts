import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "./db";

export type ShowTopicRecord = { topic: string; usedOn: string };

/** Themen einer Sendung der letzten `days` Tage (für die 90-Tage-Wiederholungssperre). */
export async function listRecentTopics(showId: string, days: number): Promise<ShowTopicRecord[]> {
  await ensureSchema();
  const sql = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 3600_000).toISOString().slice(0, 10);
  const rows = await sql`
    SELECT topic, used_on FROM show_topics
    WHERE show_id = ${showId} AND used_on >= ${cutoff}
    ORDER BY used_on DESC
  `;
  return rows.map((r) => ({ topic: String(r.topic), usedOn: String(r.used_on) }));
}

/** Bereits für heute vergebenes Thema dieser Sendung, falls vorhanden (verhindert doppelte
 *  KI-Generierung, wenn mehrere Server-Instanzen/-Neustarts denselben Tag neu prüfen). */
export async function getTopicForDate(showId: string, date: string): Promise<string | null> {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT topic FROM show_topics WHERE show_id = ${showId} AND used_on = ${date} LIMIT 1
  `;
  return rows[0] ? String(rows[0].topic) : null;
}

export async function recordTopic(showId: string, topic: string, date: string): Promise<void> {
  await ensureSchema();
  const sql = getDb();
  await sql`
    INSERT INTO show_topics (id, show_id, topic, used_on, created_at)
    VALUES (${randomUUID()}, ${showId}, ${topic}, ${date}, ${Date.now()})
  `;
}
