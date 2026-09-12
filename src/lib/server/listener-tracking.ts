import { randomUUID } from "node:crypto";
import { ensureSchema, getDb } from "./db";

/**
 * Zuhörer-Erfassung, zweigeteilt:
 * - "Stream gestartet"-Ereignisse landen dauerhaft in Postgres (listener_plays) - für
 *   Auswertungen wie "Hörer heute", übersteht einen Redeploy.
 * - "Gleichzeitige Hörer" ist dagegen bewusst nur ein flüchtiger In-Memory-Zähler (wie
 *   state.liveListeners im station-engine): Clients schicken alle ~20s einen Herzschlag, ein
 *   Client ohne aktuellen Herzschlag zählt nicht mehr mit. Passt zum Rest der App (einzelner
 *   Node-Prozess auf Render, siehe station-engine.ts) - bei mehreren Instanzen bräuchte das
 *   einen gemeinsamen Speicher (Redis o.ä.), was der aktuelle Zuschnitt nicht braucht.
 */
const HEARTBEAT_TTL_MS = 45_000;
const PLAY_RETENTION_MS = 90 * 24 * 3600_000;

const g = globalThis as unknown as { __listenerHeartbeats?: Map<string, number> };
function heartbeats() {
  g.__listenerHeartbeats ??= new Map();
  return g.__listenerHeartbeats;
}

export function touchListener(clientId: string) {
  heartbeats().set(clientId, Date.now());
}

export function getConcurrentListeners(): number {
  const now = Date.now();
  const map = heartbeats();
  for (const [id, lastSeenAt] of map) {
    if (now - lastSeenAt > HEARTBEAT_TTL_MS) map.delete(id);
  }
  return map.size;
}

export async function recordListenerPlay(clientId: string) {
  await ensureSchema();
  const sql = getDb();
  const now = Date.now();
  await sql`
    INSERT INTO listener_plays (id, client_id, started_at)
    VALUES (${randomUUID()}, ${clientId}, ${now})
  `;
  // Beiläufiges Aufräumen statt eines eigenen Cron-Jobs - hält die Tabelle unbegrenzt klein.
  await sql`DELETE FROM listener_plays WHERE started_at < ${now - PLAY_RETENTION_MS}`;
}

export async function getListenerPlayStats() {
  await ensureSchema();
  const sql = getDb();
  const now = Date.now();
  const dayAgo = now - 24 * 3600_000;
  const weekAgo = now - 7 * 24 * 3600_000;
  const [row] = await sql<{ today: string; week: string }[]>`
    SELECT
      COUNT(*) FILTER (WHERE started_at >= ${dayAgo}) AS today,
      COUNT(*) FILTER (WHERE started_at >= ${weekAgo}) AS week
    FROM listener_plays
  `;
  return { playsToday: Number(row?.today ?? 0), playsLast7Days: Number(row?.week ?? 0) };
}
