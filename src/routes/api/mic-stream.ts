import { createFileRoute } from "@tanstack/react-router";
import { pushMicAudioChunk } from "@/lib/server/station-engine";
import { requireAuth } from "@/lib/server/auth";

/** Mikrofon-Ingest: nimmt einen roh im Browser zu MP3 kodierten Byte-Chunk entgegen (alle paar
 *  hundert ms von use-mic-broadcast.ts gesendet) und reicht ihn live an /live-stream weiter.
 *  Bewusst kein WebSocket (siehe Plan) – ein einfacher POST-Chunk pro Aufruf reicht für ein
 *  Radio-Mikrofon völlig aus. */
export const Route = createFileRoute("/api/mic-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });
        const raw = await request.arrayBuffer();
        if (raw.byteLength > 0) pushMicAudioChunk(Buffer.from(raw));
        return Response.json({ ok: true });
      },
    },
  },
});
