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

const FRESH_MS = 6 * 3600_000;

/**
 * Öffentliche Staus/Blitzer-Übersicht für die Homepage (siehe /verkehr) – dieselben Daten, die
 * auch on air verwendet werden (offizielle Autobahn-API + RSS für Verkehr, Hörer-Hotline für
 * Verkehr + Blitzer). Blitzer UND Hörer-Verkehrsmeldungen bewusst ohne exakten Ort (siehe
 * stripExactSpot in planner.ts) – aus denselben rechtlichen/stilistischen Gründen wie on air
 * (vergleichbar mit dem Verbot von Radarwarn-Geräten/-Apps, siehe trafficLine/blitzerLine).
 */
export const Route = createFileRoute("/api/public/traffic-overview")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => {
        const traffic = getTrafficSnapshot();
        const now = Date.now();
        const fresh = listHotlineReports().filter((h) => now - h.createdAt < FRESH_MS);
        const blitzer = fresh
          .filter((h) => h.type === "blitzer")
          .map((h) => ({
            id: h.id,
            region: h.region,
            place: h.place || null,
            road: h.road || null,
            message: stripExactSpot(h.message ?? "") || null,
            createdAt: h.createdAt,
          }));
        // Hörer-Verkehrsmeldungen (Stau/Unfall/Sperrung) fehlten hier bisher komplett – nur
        // Blitzer wurde gezeigt. Gehören genauso zur Übersicht wie im gesprochenen Verkehrsblock
        // (siehe trafficText in planner.ts, das sie inzwischen auch zuverlässig einbezieht).
        const hotlineTraffic = fresh
          .filter((h) => h.type === "verkehr")
          .map((h) => ({
            id: h.id,
            region: h.region,
            place: h.place || null,
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
            hotlineTraffic,
            blitzer,
            updatedAt: now,
          },
          { headers: cors },
        );
      },
    },
  },
});
