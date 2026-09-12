import { createFileRoute } from "@tanstack/react-router";
import {
  getConcurrentListeners,
  getListenerPlayStats,
  getListenerPlaysByDay,
} from "@/lib/server/listener-tracking";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Cache-Control": "no-store",
};

/** Öffentliche Zuhörer-Statistik - auch von der Django-Website genutzt (RADIO_LISTENER_STATS_API_URL). */
export const Route = createFileRoute("/api/public/listener-stats")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => {
        const concurrent = getConcurrentListeners();
        const { playsToday, playsLast7Days } = await getListenerPlayStats().catch(() => ({
          playsToday: 0,
          playsLast7Days: 0,
        }));
        const byDay = await getListenerPlaysByDay(7).catch(() => []);
        return Response.json(
          { concurrent, playsToday, playsLast7Days, byDay, updatedAt: Date.now() },
          { headers: cors },
        );
      },
    },
  },
});
