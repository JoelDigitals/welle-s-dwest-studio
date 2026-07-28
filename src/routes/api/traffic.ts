import { createFileRoute } from "@tanstack/react-router";
import { fetchTraffic } from "@/lib/server/fetch-traffic";

export const Route = createFileRoute("/api/traffic")({
  server: {
    handlers: {
      GET: async () => {
        const result = await fetchTraffic();
        return Response.json(result, { headers: { "Cache-Control": "public, max-age=180" } });
      },
    },
  },
});
