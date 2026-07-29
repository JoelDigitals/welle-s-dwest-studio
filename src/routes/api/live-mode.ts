import { createFileRoute } from "@tanstack/react-router";
import { getLiveMode, setLiveModeManual, startStationEngine } from "@/lib/server/station-engine";
import { requireAuth } from "@/lib/server/auth";

startStationEngine();

/**
 * Schaltet zwischen Autopilot und Livestudio um. Im Livestudio-Modus pausiert der Autopilot
 * komplett, die Sendung spielt ausschließlich, was über /api/live-queue manuell hineingegeben
 * wird (siehe station-engine.ts – setLiveMode/addToLiveQueue).
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

export const Route = createFileRoute("/api/live-mode")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => Response.json({ live: getLiveMode() }, { headers: cors }),
      POST: async ({ request }) => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401, headers: cors });
        const body = (await request.json().catch(() => null)) as { live?: boolean } | null;
        if (typeof body?.live !== "boolean") {
          return Response.json({ error: "live (boolean) fehlt" }, { status: 400, headers: cors });
        }
        setLiveModeManual(body.live);
        return Response.json({ ok: true, live: getLiveMode() }, { headers: cors });
      },
    },
  },
});
