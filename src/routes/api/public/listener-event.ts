import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { recordListenerPlay, touchListener } from "@/lib/server/listener-tracking";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

const schema = z.object({
  clientId: z.string().trim().min(8).max(80),
  type: z.enum(["start", "heartbeat"]),
});

/** Vom Player aufgerufen (siehe use-live-broadcast.ts): "start" einmal, wenn die Wiedergabe
 * beginnt (loggt dauerhaft einen Play), "heartbeat" danach alle ~20s, solange noch abgespielt
 * wird (hält den Client in der Zählung der gleichzeitigen Hörer). */
export const Route = createFileRoute("/api/public/listener-event")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "ungültige Anfrage" }, { status: 400, headers: cors });
        }
        const { clientId, type } = parsed.data;
        touchListener(clientId);
        if (type === "start") {
          await recordListenerPlay(clientId).catch(() => undefined);
        }
        return Response.json({ ok: true }, { headers: cors });
      },
    },
  },
});
