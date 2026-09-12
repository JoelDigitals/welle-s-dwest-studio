import { createFileRoute } from "@tanstack/react-router";
import { getNewsSnapshot, startStationEngine } from "@/lib/server/station-engine";
import { getOrWriteArticle } from "@/lib/server/news-articles-store";

startStationEngine();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Cache-Control": "no-store",
};

/**
 * Öffentliche News-Seite (/nachrichten): dieselben echten Meldungen wie on air, aber von der KI
 * zu einem etwas ausführlicheren geschriebenen Artikel ausgebaut (siehe tryWriteNewsArticle) statt
 * nur roh vorgelesen. Fakten bleiben dabei immer die des Ausgangsmaterials (RSS-Feed) – nichts
 * wird neu erfunden. Artikel werden gecacht (news-articles-store.ts), damit nicht bei jedem
 * Seitenaufruf neu generiert wird.
 */
export const Route = createFileRoute("/api/public/news-page")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => {
        const news = getNewsSnapshot().slice(0, 16);
        const items = await Promise.all(
          news.map(async (n) => ({
            id: n.id,
            region: n.region,
            headline: n.headline,
            source: n.source,
            link: n.link ?? null,
            publishedAt: n.publishedAt ?? null,
            article: await getOrWriteArticle(n.headline, n.body),
          })),
        );
        return Response.json({ items, updatedAt: Date.now() }, { headers: cors });
      },
    },
  },
});
