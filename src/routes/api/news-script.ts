import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/server/auth";
import { getNewsSnapshot } from "@/lib/server/station-engine";
import { tryHumanizeNews } from "@/lib/server/moderation-text";
import { newsScriptFor } from "@/lib/planner";
import { screenAiText, stripNewsTitleMarkers } from "@/lib/station-rules";

/**
 * Nachrichtentext wie im Autopilot: dieselben (KI-sortierten) Meldungen der Sende-Engine, derselbe
 * Aufbau ("Mit NAME" und dann direkt die Meldungen) und dieselbe KI-Glättung wie vor der
 * Sprachausgabe der Engine. Für Livesendung, Text-Studio und Newsroom.
 */
export const Route = createFileRoute("/api/news-script")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });
        const mode = new URL(request.url).searchParams.get("mode") === "short" ? "short" : "full";
        const { text, anchor, sources } = newsScriptFor(
          { media: [], news: getNewsSnapshot(), traffic: [], reports: [] },
          mode,
          Date.now(),
        );
        const screened = screenAiText(await tryHumanizeNews(text));
        return Response.json({
          text: stripNewsTitleMarkers(screened.text),
          anchor: { id: anchor.id, name: anchor.name, voice: anchor.voice },
          meta: {
            auto_generated: true,
            sources,
            ts: new Date().toISOString(),
            editor_needed: screened.editorNeeded || screened.sourceMissing,
          },
        });
      },
    },
  },
});
