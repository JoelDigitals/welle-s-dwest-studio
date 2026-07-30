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
  // Tagesthemen je Sendung – verhindert, dass sich das Thema einer Show innerhalb von 90 Tagen
  // wiederholt (außer eine große, andauernde Nachrichtenlage rechtfertigt es ausdrücklich).
  await sql`
    CREATE TABLE IF NOT EXISTS show_topics (
      id TEXT PRIMARY KEY,
      show_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      used_on TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_show_topics_show_date ON show_topics(show_id, used_on)
  `;
  // Medienbibliothek (Musik/Jingles/Slogans/Werbung/Aufnahmen): lag vorher nur in einer lokalen
  // JSON-Datei auf dem flüchtigen Render-Dateisystem – ging bei jedem Redeploy verloren (der
  // Grund für den früheren "Bibliothek ist leer"-Vorfall). Jetzt dauerhaft in Postgres.
  await sql`
    CREATE TABLE IF NOT EXISTS media_library (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      duration INTEGER NOT NULL DEFAULT 0,
      file_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      run_from BIGINT,
      run_until BIGINT,
      per_hour INTEGER,
      sponsor_of TEXT,
      slot TEXT,
      stream_url TEXT,
      license TEXT,
      source TEXT,
      owner_id TEXT
    )
  `;
  g.__schemaReady = true;
}
