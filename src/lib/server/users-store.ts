import { randomUUID } from "node:crypto";
import { getDb, ensureSchema } from "./db";

export type UserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  hostId: string | null;
  createdAt: number;
};

function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    username: String(row.username),
    passwordHash: String(row.password_hash),
    displayName: String(row.display_name),
    hostId: row.host_id == null ? null : String(row.host_id),
    createdAt: Number(row.created_at),
  };
}

export async function countUsers(): Promise<number> {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`SELECT COUNT(*)::int AS n FROM users`;
  return Number(rows[0]?.n ?? 0);
}

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`SELECT * FROM users WHERE username = ${username} LIMIT 1`;
  return rows[0] ? rowToUser(rows[0] as unknown as Record<string, unknown>) : null;
}

export async function createUser(input: {
  username: string;
  passwordHash: string;
  displayName: string;
  hostId?: string | null;
}): Promise<UserRecord> {
  await ensureSchema();
  const sql = getDb();
  const id = randomUUID();
  const createdAt = Date.now();
  await sql`
    INSERT INTO users (id, username, password_hash, display_name, host_id, created_at)
    VALUES (${id}, ${input.username}, ${input.passwordHash}, ${input.displayName}, ${input.hostId ?? null}, ${createdAt})
  `;
  return {
    id,
    username: input.username,
    passwordHash: input.passwordHash,
    displayName: input.displayName,
    hostId: input.hostId ?? null,
    createdAt,
  };
}
