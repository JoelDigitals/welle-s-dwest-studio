import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "./db";
import type { LiveSlot } from "@/lib/broadcast-types";

function rowToSlot(row: Record<string, unknown>): LiveSlot {
  return {
    id: String(row.id),
    title: String(row.title),
    hostId: row.host_id == null ? "" : String(row.host_id),
    hostName: String(row.host_name),
    startAt: Number(row.start_at),
    minutes: Number(row.minutes),
    note: String(row.note ?? ""),
  };
}

export async function listScheduledShows(): Promise<LiveSlot[]> {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`SELECT * FROM scheduled_shows ORDER BY start_at ASC`;
  return rows.map((r) => rowToSlot(r as unknown as Record<string, unknown>));
}

export async function createScheduledShow(input: {
  title: string;
  hostId: string;
  hostName: string;
  startAt: number;
  minutes: number;
  note?: string;
  createdBy: string;
}): Promise<LiveSlot> {
  await ensureSchema();
  const sql = getDb();
  const id = randomUUID();
  await sql`
    INSERT INTO scheduled_shows
      (id, title, host_id, host_name, start_at, minutes, note, created_by, created_at)
    VALUES (
      ${id}, ${input.title}, ${input.hostId}, ${input.hostName},
      ${input.startAt}, ${input.minutes}, ${input.note ?? ""}, ${input.createdBy}, ${Date.now()}
    )
  `;
  return {
    id,
    title: input.title,
    hostId: input.hostId,
    hostName: input.hostName,
    startAt: input.startAt,
    minutes: input.minutes,
    note: input.note ?? "",
  };
}

export async function removeScheduledShow(id: string): Promise<void> {
  await ensureSchema();
  const sql = getDb();
  await sql`DELETE FROM scheduled_shows WHERE id = ${id}`;
}
