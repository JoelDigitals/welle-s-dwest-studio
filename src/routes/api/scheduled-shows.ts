import { createFileRoute } from "@tanstack/react-router";
import {
  listScheduledShows,
  createScheduledShow,
  removeScheduledShow,
} from "@/lib/server/scheduled-shows-store";
import { requireAuth } from "@/lib/server/auth";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

/**
 * Im Voraus geplante Sendetermine (Datum/Uhrzeit/Titel/Host) – die Sende-Engine schaltet zur
 * Startzeit automatisch in den Livestudio-Modus und am Ende automatisch wieder zurück
 * (siehe station-engine.ts – tickScheduledShows).
 */
export const Route = createFileRoute("/api/scheduled-shows")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401, headers: cors });
        try {
          return Response.json(await listScheduledShows(), { headers: cors });
        } catch (err) {
          console.error("[scheduled-shows] Datenbank nicht erreichbar:", err);
          return Response.json({ error: "Datenbank nicht erreichbar" }, { status: 503, headers: cors });
        }
      },
      POST: async ({ request }) => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401, headers: cors });
        const body = (await request.json().catch(() => null)) as {
          title?: string;
          hostId?: string;
          hostName?: string;
          startAt?: number;
          minutes?: number;
          note?: string;
        } | null;
        if (!body?.title || !body.hostName || !body.startAt || !body.minutes) {
          return Response.json(
            { error: "title, hostName, startAt und minutes fehlen" },
            { status: 400, headers: cors },
          );
        }
        try {
          const show = await createScheduledShow({
            title: body.title,
            hostId: body.hostId ?? "",
            hostName: body.hostName,
            startAt: body.startAt,
            minutes: body.minutes,
            note: body.note,
            createdBy: user.userId,
          });
          return Response.json({ ok: true, show }, { headers: cors });
        } catch (err) {
          console.error("[scheduled-shows] Datenbank nicht erreichbar:", err);
          return Response.json({ error: "Datenbank nicht erreichbar" }, { status: 503, headers: cors });
        }
      },
      DELETE: async ({ request }) => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401, headers: cors });
        const id = new URL(request.url).searchParams.get("id");
        if (!id) return Response.json({ error: "id fehlt" }, { status: 400, headers: cors });
        await removeScheduledShow(id);
        return Response.json({ ok: true }, { headers: cors });
      },
    },
  },
});
