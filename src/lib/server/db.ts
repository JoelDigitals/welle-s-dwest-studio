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
  // Nachträglich hinzugekommen: wiederkehrendes Wochentags-/Uhrzeit-Zeitfenster für Jingles/
  // Slogans (z. B. nur werktags 6-9 Uhr), zusätzlich zum bestehenden Datumsbereich (run_from/
  // run_until) oben.
  await sql`ALTER TABLE media_library ADD COLUMN IF NOT EXISTS schedule_days INTEGER[]`;
  await sql`ALTER TABLE media_library ADD COLUMN IF NOT EXISTS schedule_time_from TEXT`;
  await sql`ALTER TABLE media_library ADD COLUMN IF NOT EXISTS schedule_time_until TEXT`;
  // Zuhörer-Erfassung: jede Zeile ist ein "Stream gestartet"-Ereignis eines Clients (siehe
  // listener-tracking.ts). Dauerhaft in Postgres, damit Auswertungen (z. B. "Hörer heute") einen
  // Render-Redeploy überleben - anders als die gleichzeitige-Hörer-Zählung, die bewusst nur
  // flüchtig im Speicher lebt (siehe getConcurrentListeners).
  await sql`
    CREATE TABLE IF NOT EXISTS listener_plays (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      started_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_listener_plays_started ON listener_plays(started_at)
  `;
  // KI-geschriebene Nachrichtenartikel für die /nachrichten-Seite (Studio) und die Website -
  // dauerhaft in Postgres, damit ein Artikel sichtbar bleibt, auch wenn die zugrunde liegende
  // RSS-Meldung längst aus dem Live-Feed gerutscht ist (siehe news-articles-store.ts).
  await sql`
    CREATE TABLE IF NOT EXISTS news_articles (
      id TEXT PRIMARY KEY,
      region TEXT NOT NULL,
      headline TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      link TEXT,
      published_at TEXT,
      article TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_news_articles_created ON news_articles(created_at DESC)
  `;
  // Nachträglich hinzugekommen: hält fest, ob "article" wirklich von der KI umgeschrieben wurde
  // oder nur der unveränderte Roh-RSS-Text ist (KI gerade nicht erreichbar, z. B. Freikontingent
  // ausgeschöpft) - nur so lassen sich später "steckengebliebene" Roh-Artikel automatisch erneut
  // versuchen (siehe upgradeThinArticles in news-articles-store.ts), ohne echte kurze
  // KI-Entscheidungen ("zu diesem Thema gibt es nicht mehr zu sagen") fälschlich zu wiederholen.
  await sql`ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT true`;
  // Einmalige Korrektur für Artikel, die VOR Einführung dieser Spalte gespeichert wurden (der
  // Default "true" trifft auf sie nicht zu) - sehr kurze Artikel waren zu dem Zeitpunkt praktisch
  // immer der unveränderte RSS-Rohtext (KI nicht erreichbar), kein bewusst kurz gehaltener
  // KI-Artikel. Betrifft neue, korrekt gekennzeichnete Artikel danach nicht mehr.
  await sql`UPDATE news_articles SET ai_generated = false WHERE ai_generated = true AND length(article) < 300`;
  g.__schemaReady = true;
}
