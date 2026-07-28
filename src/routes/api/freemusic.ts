import { createFileRoute } from "@tanstack/react-router";
import { searchFreeMusic } from "@/lib/server/freemusic-search";

export const Route = createFileRoute("/api/freemusic")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const items = await searchFreeMusic(
          params.get("q") ?? "pop",
          Number(params.get("limit")) || 10,
        );
        // Kein langlebiges Caching: alte, im Client gecachte Treffer können auf inzwischen
        // toten/veralteten Stream-URLs zeigen und Abspielfehler verursachen.
        return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
