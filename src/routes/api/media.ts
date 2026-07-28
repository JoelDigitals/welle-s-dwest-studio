import { createFileRoute } from "@tanstack/react-router";
import {
  listStoredMedia,
  addStoredFile,
  addStoredMeta,
  removeStoredMedia,
} from "@/lib/server/media-store";
import type { MediaRecord } from "@/lib/media-db";

/**
 * Server-seitige Medienbibliothek: Musik/Jingles/Slogans/Werbespots, die die autonome
 * Sende-Engine tatsächlich verwenden kann (anders als die browserseitige IndexedDB-Bibliothek).
 * Das Studio schreibt hier zusätzlich zur lokalen IndexedDB-Bibliothek hin (siehe
 * use-media-library.ts), damit beide in Sync bleiben.
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

export const Route = createFileRoute("/api/media")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => Response.json(await listStoredMedia(), { headers: cors }),
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as {
          meta?: Omit<MediaRecord, "blob">;
          dataBase64?: string;
        } | null;
        if (!body?.meta?.id) {
          return Response.json({ error: "Ungültige Daten" }, { status: 400, headers: cors });
        }
        try {
          if (body.dataBase64) {
            const buffer = Buffer.from(body.dataBase64, "base64");
            await addStoredFile(body.meta, buffer);
          } else {
            await addStoredMeta(body.meta);
          }
          return Response.json({ ok: true }, { headers: cors });
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "Speichern fehlgeschlagen" },
            { status: 500, headers: cors },
          );
        }
      },
      DELETE: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("id");
        if (!id) return Response.json({ error: "id fehlt" }, { status: 400, headers: cors });
        await removeStoredMedia(id);
        return Response.json({ ok: true }, { headers: cors });
      },
    },
  },
});
