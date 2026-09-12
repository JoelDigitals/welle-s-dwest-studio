import type { NewsFeedItem } from "@/lib/broadcast-types";
import { ensureSchema, getDb } from "./db";
import { tryWriteNewsArticle } from "./moderation-text";

export type PersistedArticle = {
  id: string;
  region: string;
  headline: string;
  source: string;
  link: string | null;
  publishedAt: string | null;
  article: string;
  createdAt: number;
};

/** Wie viele Artikel maximal aufgehoben werden (siehe pruneOldArticles) – großzügig genug, dass
 *  Artikel lange sichtbar bleiben (auch wenn die Ursprungsmeldung längst aus dem Live-Feed
 *  gerutscht ist), aber nicht unbegrenzt wächst. */
const MAX_ARTICLES = 500;

function rowToArticle(row: Record<string, unknown>): PersistedArticle {
  return {
    id: String(row.id),
    region: String(row.region),
    headline: String(row.headline),
    source: String(row.source ?? ""),
    link: row.link == null ? null : String(row.link),
    publishedAt: row.published_at == null ? null : String(row.published_at),
    article: String(row.article),
    createdAt: Number(row.created_at),
  };
}

/** Schreibt für jede noch nicht gespeicherte Meldung einen KI-Artikel und persistiert ihn –
 *  läuft im Hintergrund (siehe station-engine.ts, refreshFeeds), blockiert also nie den
 *  eigentlichen Sende-Tick. Bereits gespeicherte Meldungen (gleiche id) werden übersprungen, damit
 *  ein unverändertes Feed-Item nicht bei jedem Refresh neu (und teuer) generiert wird – ein
 *  fehlgeschlagener Versuch (KI nicht erreichbar) wird aber als solcher markiert (ai_generated =
 *  false) und später von upgradeThinArticles automatisch erneut versucht. */
export async function ensureArticlesPersisted(items: NewsFeedItem[]): Promise<void> {
  if (!items.length) return;
  await ensureSchema();
  const sql = getDb();
  for (const item of items) {
    if (!item.headline) continue;
    try {
      const existing = await sql`SELECT 1 FROM news_articles WHERE id = ${item.id} LIMIT 1`;
      if (existing.length) continue;
      const { article, generated } = await tryWriteNewsArticle(item.headline, item.body);
      await sql`
        INSERT INTO news_articles (id, region, headline, source, link, published_at, article, created_at, ai_generated)
        VALUES (
          ${item.id}, ${item.region}, ${item.headline}, ${item.source ?? ""},
          ${item.link ?? null}, ${item.publishedAt ?? null}, ${article}, ${Date.now()}, ${generated}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    } catch {
      // ein einzelnes fehlgeschlagenes Item (z. B. KI-Rate-Limit) darf die anderen nicht blockieren
    }
  }
  await pruneOldArticles();
}

/** Versucht für eine kleine Anzahl Artikel, die beim ersten Mal nur der unveränderte RSS-Rohtext
 *  wurden (KI damals nicht erreichbar, z. B. Freikontingent ausgeschöpft), den echten Artikel
 *  nachträglich zu schreiben – unabhängig davon, ob die Ursprungsmeldung noch im Live-Feed steht
 *  (ensureArticlesPersisted sieht solche längst rotierten Meldungen nie wieder). Bewusst klein
 *  limitiert pro Aufruf, damit ein Rate-Limit nicht sofort wieder alle Versuche verbraucht. */
export async function upgradeThinArticles(limit = 5): Promise<void> {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT id, headline, article FROM news_articles
    WHERE ai_generated = false
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  for (const row of rows) {
    const id = String(row.id);
    const headline = String(row.headline);
    const rawBody = String(row.article);
    try {
      const { article, generated } = await tryWriteNewsArticle(headline, rawBody);
      if (!generated) continue; // KI immer noch nicht erreichbar - nächster Versuch beim nächsten Zyklus
      await sql`UPDATE news_articles SET article = ${article}, ai_generated = true WHERE id = ${id}`;
    } catch {
      // einzelner fehlgeschlagener Versuch darf die anderen nicht blockieren
    }
  }
}

async function pruneOldArticles(): Promise<void> {
  const sql = getDb();
  await sql`
    DELETE FROM news_articles
    WHERE id NOT IN (SELECT id FROM news_articles ORDER BY created_at DESC LIMIT ${MAX_ARTICLES})
  `;
}

/** Seitenweise, nach Aktualität sortiert – für die paginierte /nachrichten-Übersicht (Studio +
 *  Website). Neueste zuerst, unabhängig davon, ob die Meldung noch im Live-Feed steht. Mit
 *  optionalem Suchbegriff (Schlagzeile + Artikeltext, groß-/kleinschreibungsunabhängig). */
export async function listArticlesPage(
  page: number,
  pageSize: number,
  query?: string,
): Promise<{ items: PersistedArticle[]; total: number }> {
  await ensureSchema();
  const sql = getDb();
  const safePageSize = Math.min(500, Math.max(1, pageSize));
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * safePageSize;
  const q = query?.trim();
  const [rows, countRows] = q
    ? await Promise.all([
        sql`
          SELECT * FROM news_articles
          WHERE headline ILIKE ${`%${q}%`} OR article ILIKE ${`%${q}%`}
          ORDER BY created_at DESC LIMIT ${safePageSize} OFFSET ${offset}
        `,
        sql`
          SELECT COUNT(*)::int AS count FROM news_articles
          WHERE headline ILIKE ${`%${q}%`} OR article ILIKE ${`%${q}%`}
        `,
      ])
    : await Promise.all([
        sql`SELECT * FROM news_articles ORDER BY created_at DESC LIMIT ${safePageSize} OFFSET ${offset}`,
        sql`SELECT COUNT(*)::int AS count FROM news_articles`,
      ]);
  return {
    items: rows.map((r) => rowToArticle(r as unknown as Record<string, unknown>)),
    total: Number((countRows[0] as { count: number } | undefined)?.count ?? 0),
  };
}
