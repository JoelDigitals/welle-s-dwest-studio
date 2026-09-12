import { createFileRoute } from "@tanstack/react-router";
import { getTrafficSnapshot, startStationEngine } from "@/lib/server/station-engine";
import { listHotlineReports } from "@/lib/server/hotline-store";
import { stripExactSpot } from "@/lib/planner";

startStationEngine();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Cache-Control": "no-store",
};

/**
 * Öffentliche Staus/Blitzer-Übersicht für die Homepage (siehe /verkehr) – dieselben Daten, die
 * auch on air verwendet werden (offizielle Autobahn-API + RSS für Verkehr, Hörer-Hotline für
 * Blitzer). Blitzer bewusst ohne exakten Ort (siehe stripExactSpot in planner.ts) – aus denselben
 * rechtlichen Gründen wie on air (vergleichbar mit dem Verbot von Radarwarn-Geräten/-Apps).
 */
export const Route = createFileRoute("/api/public/traffic-overview")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => {
        const traffic = getTrafficSnapshot();
        const now = Date.now();
        const blitzer = listHotlineReports()
          .filter((h) => h.type === "blitzer" && now - h.createdAt < 6 * 3600_000)
          .map((h) => ({
            id: h.id,
            region: h.region,
            road: h.road || null,
            message: stripExactSpot(h.message ?? "") || null,
            createdAt: h.createdAt,
          }));
        return Response.json(
          {
            traffic: traffic.map((t) => ({
              id: t.id,
              road: t.road,
              region: t.region,
              headline: t.headline,
              message: t.message,
              since: t.since,
            })),
            blitzer,
            updatedAt: now,
          },
          { headers: cors },
        );
      },
    },
  },
});
