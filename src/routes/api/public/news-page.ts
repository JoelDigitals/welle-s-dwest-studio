import { createFileRoute } from "@tanstack/react-router";
import { startStationEngine } from "@/lib/server/station-engine";
import { listArticlesPage } from "@/lib/server/news-articles-store";

startStationEngine();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Cache-Control": "no-store",
};

const DEFAULT_PAGE_SIZE = 20;

/**
 * Öffentliche News-Seite (/nachrichten): dieselben echten Meldungen wie on air, aber von der KI
 * zu einem ausführlicheren geschriebenen Artikel ausgebaut (siehe tryWriteNewsArticle) statt nur
 * roh vorgelesen. Fakten bleiben dabei immer die des Ausgangsmaterials (RSS-Feed) – nichts wird
 * neu erfunden.
 *
 * Liest dauerhaft aus Postgres (news_articles, siehe news-articles-store.ts) statt nur aus dem
 * flüchtigen Live-Feed-Snapshot – ein Artikel bleibt hier sichtbar, auch wenn die Ursprungsmeldung
 * längst aus dem RSS-Feed gerutscht ist. Paginiert (page/pageSize), nach Aktualität sortiert.
 */
export const Route = createFileRoute("/api/public/news-page")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
        const pageSize = Math.min(
          500,
          Math.max(1, Number(url.searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE),
        );
        const { items, total } = await listArticlesPage(page, pageSize);
        return Response.json(
          {
            items,
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            updatedAt: Date.now(),
          },
          { headers: cors },
        );
      },
    },
  },
});
