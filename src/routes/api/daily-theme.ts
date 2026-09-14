import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/server/auth";
import { getDailyThemes, setDailyThemeOverride, startStationEngine } from "@/lib/server/station-engine";

startStationEngine();

type Body = { showId?: string; topic?: string };

/** Tagesthemen im Studio: GET zeigt, was die KI (oder eine vorherige manuelle Festlegung) für
 *  heute je Sendung gewählt hat, POST erlaubt der Redaktion eine eigene Übersteuerung (siehe
 *  setDailyThemeOverride in station-engine.ts) - z. B. für ein großes lokales Ereignis, auf das
 *  die KI ohne Kontingent gerade nicht selbst kommen kann. */
export const Route = createFileRoute("/api/daily-theme")({
  server: {
    handlers: {
      GET: async () => {
        const authUser = await requireAuth();
        if (!authUser) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });
        return Response.json({ items: getDailyThemes() });
      },
      POST: async ({ request }) => {
        const authUser = await requireAuth();
        if (!authUser) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });
        }
        const showId = body.showId?.trim();
        const topic = body.topic?.trim();
        if (!showId || !topic || topic.length < 3) {
          return Response.json({ error: "Sendung und Thema (mind. 3 Zeichen) angeben." }, { status: 400 });
        }
        await setDailyThemeOverride(showId, topic.slice(0, 200));
        return Response.json({ items: getDailyThemes() });
      },
    },
  },
});
