import { createFileRoute } from "@tanstack/react-router";
import { getTrafficSnapshot, startStationEngine } from "@/lib/server/station-engine";
import { listHotlineReports } from "@/lib/server/hotline-store";
import { stripExactSpot, classifyTraffic, dedupeByLocation } from "@/lib/planner";

startStationEngine();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Cache-Control": "no-store",
};

// Wie lange eine Meldung auf der ÖFFENTLICHEN Website sichtbar bleibt - bewusst getrennt von der
// Gültigkeit im gesprochenen Programm (siehe HOTLINE_FRESHNESS_MS in planner.ts, dort deutlich
// kürzer, z. B. 2h für Blitzer, weil ein mobiler Blitzer längst weitergezogen ist). Auf der
// Website hat ein Blitzer aber informativen Wert auch Tage später ("wo wurde zuletzt geblitzt"),
// deshalb 5 Tage. Verkehr bleibt kürzer sichtbar, sonst wirkt eine Tage alte Stau-Meldung wie eine
// aktuelle.
const BLITZER_FRESH_MS = 5 * 24 * 3600_000;
const VERKEHR_FRESH_MS = 6 * 3600_000;

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
        const allHotline = await listHotlineReports();
        const freshBlitzer = allHotline.filter(
          (h) => h.type === "blitzer" && now - h.createdAt < BLITZER_FRESH_MS,
        );
        const freshVerkehr = allHotline.filter(
          (h) => h.type === "verkehr" && now - h.createdAt < VERKEHR_FRESH_MS,
        );
        // Mehrere Anrufe zur selben Stelle (unterschiedlich formuliert) nicht mehrfach zeigen -
        // siehe dedupeByLocation in planner.ts.
        const blitzer = dedupeByLocation(freshBlitzer).map((h) => ({
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
        const hotlineTraffic = dedupeByLocation(freshVerkehr).map(
          (h) => ({
            id: h.id,
            region: h.region,
            place: h.place || null,
            road: h.road || null,
            message: stripExactSpot(h.message ?? "") || null,
            createdAt: h.createdAt,
            ...classifyTraffic(`${h.place ?? ""} ${h.road ?? ""} ${h.message ?? ""}`),
          }),
        );
        // Nach Dringlichkeit sortiert (Unfälle/Sperrungen zuerst) statt in Feed-Reihenfolge - siehe
        // classifyTraffic in planner.ts, dieselbe Einordnung wie im gesprochenen Verkehrsblock.
        const trafficWithCategory = traffic
          .map((t) => ({
            id: t.id,
            road: t.road,
            region: t.region,
            headline: t.headline,
            message: t.message,
            since: t.since,
            ...classifyTraffic(`${t.headline} ${t.message}`),
          }))
          .sort((a, b) => Number(b.urgent) - Number(a.urgent));
        return Response.json(
          {
            traffic: trafficWithCategory,
            hotlineTraffic: hotlineTraffic.sort((a, b) => Number(b.urgent) - Number(a.urgent)),
            blitzer,
            updatedAt: now,
          },
          { headers: cors },
        );
      },
    },
  },
});
