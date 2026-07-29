import postgres from "postgres";

/**
 * Persistente Datenbank für Dinge, die einen Render-Redeploy überleben MÜSSEN
 * (Accounts, geplante Sendetermine) – anders als die globalThis-Stores für
 * Werbebuchungen/Hotline, die absichtlich flüchtig sein dürfen.
 * Supabase-Postgres über den Transaction-Pooler (Port 6543) – "prepare: false" ist dafür
 * Pflicht, da pgbouncer im Transaction-Modus keine Prepared Statements über mehrere
 * Anfragen hinweg zulässt.
 */
const g = globalThis as unknown as {
  __pg?: ReturnType<typeof postgres>;
  __schemaReady?: boolean;
};

export function getDb() {
  g.__pg ??= postgres(process.env.DATABASE_URL ?? "", {
    prepare: false,
    ssl: "require",
  });
  return g.__pg;
}

export async function ensureSchema() {
  if (g.__schemaReady) return;
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      host_id TEXT,
      created_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS scheduled_shows (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      host_id TEXT,
      host_name TEXT NOT NULL,
      start_at BIGINT NOT NULL,
      minutes INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_scheduled_shows_start ON scheduled_shows(start_at)
  `;
  g.__schemaReady = true;
}
