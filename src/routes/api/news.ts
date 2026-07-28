import { createFileRoute } from "@tanstack/react-router";
import { fetchNews } from "@/lib/server/fetch-news";

export const Route = createFileRoute("/api/news")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const limit = Number(new URL(request.url).searchParams.get("limit")) || 4;
        const result = await fetchNews(limit);
        return Response.json(result, { headers: { "Cache-Control": "public, max-age=300" } });
      },
    },
  },
});
