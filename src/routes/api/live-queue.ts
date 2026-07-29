import { createFileRoute } from "@tanstack/react-router";
import {
  addToLiveQueue,
  removeFromLiveQueue,
  reorderLiveQueue,
  startStationEngine,
  getLiveQueue,
  type LiveQueueInput,
} from "@/lib/server/station-engine";
import { requireAuth } from "@/lib/server/auth";

startStationEngine();

/**
 * Manuelle Live-Warteschlange fürs Livestudio (siehe station-engine.ts). Nur wirksam, solange
 * der Livestudio-Modus (/api/live-mode) aktiv ist – sonst liegt hier zwar etwas in der
 * Warteschlange, gesendet wird aber weiterhin der Autopilot.
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

export const Route = createFileRoute("/api/live-queue")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401, headers: cors });
        return Response.json(getLiveQueue(), { headers: cors });
      },
      POST: async ({ request }) => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401, headers: cors });
        const body = (await request.json().catch(() => null)) as {
          item?: LiveQueueInput;
          playNow?: boolean;
        } | null;
        const item = body?.item;
        if (!item?.kind || !item.title || !item.duration) {
          return Response.json(
            { error: "item (kind, title, duration) fehlt" },
            { status: 400, headers: cors },
          );
        }
        const added = addToLiveQueue(item, Boolean(body?.playNow));
        return Response.json({ ok: true, item: added }, { headers: cors });
      },
      PATCH: async ({ request }) => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401, headers: cors });
        const body = (await request.json().catch(() => null)) as {
          fromUid?: string;
          toUid?: string;
        } | null;
        if (!body?.fromUid || !body.toUid) {
          return Response.json(
            { error: "fromUid und toUid fehlen" },
            { status: 400, headers: cors },
          );
        }
        reorderLiveQueue(body.fromUid, body.toUid);
        return Response.json({ ok: true }, { headers: cors });
      },
      DELETE: async ({ request }) => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401, headers: cors });
        const uid = new URL(request.url).searchParams.get("uid");
        if (!uid) return Response.json({ error: "uid fehlt" }, { status: 400, headers: cors });
        removeFromLiveQueue(uid);
        return Response.json({ ok: true }, { headers: cors });
      },
    },
  },
});
