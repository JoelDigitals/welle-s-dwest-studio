import { createFileRoute } from "@tanstack/react-router";
import { fetchTraffic } from "@/lib/server/fetch-traffic";
import { getTrafficSnapshot, startStationEngine } from "@/lib/server/station-engine";
import { listHotlineReports } from "@/lib/server/hotline-store";
import { withoutResolved } from "@/lib/planner";

/**
 * Verkehrsliste fürs Studio: derselbe zusammengeführte Stand, den die Sende-Engine sendet –
 * Autobahn-API, Radio Salü und RPR1 ohne Doppelungen, entwarnte Lagen entfernt. Nur solange die
 * Engine noch keine Daten hat (direkt nach dem Start), wird die Autobahn-API direkt abgefragt.
 */
export const Route = createFileRoute("/api/traffic")({
  server: {
    handlers: {
      GET: async () => {
        startStationEngine();
        const merged = getTrafficSnapshot();
        if (!merged.length) {
          const result = await fetchTraffic();
          return Response.json(result, { headers: { "Cache-Control": "no-store" } });
        }
        const hotline = await listHotlineReports().catch(() => []);
        return Response.json(
          {
            fetchedAt: new Date().toISOString(),
            items: withoutResolved(merged, hotline),
            errors: [],
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
