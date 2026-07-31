import { createFileRoute } from "@tanstack/react-router";
import { AiError } from "@/lib/ai-text";
import {
  generateModerationText,
  tryHumanizeTraffic,
  tryHumanizeBlitzer,
  tryHumanizeNews,
} from "@/lib/server/moderation-text";
import { requireAuth } from "@/lib/server/auth";

type Body = {
  kind?: string;
  brief?: string;
  hostName?: string;
};

export const Route = createFileRoute("/api/script")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });
        }

        const brief = typeof body.brief === "string" ? body.brief.trim() : "";
        if (!brief) {
          return Response.json({ error: "Kein Briefing übergeben." }, { status: 400 });
        }

        try {
          // Nachrichten, Verkehr und Blitzer-Service werden mit einem faktentreuen Prompt
          // umformuliert (Namen/Straßen/Orte/Angaben bleiben exakt, nur die Sprachform wird
          // natürlicher) – die freie Moderation dürfte hier neue Inhalte erfinden, das wäre bei
          // echten Meldungen falsch.
          const text =
            body.kind === "Nachrichten (faktengetreu umformulieren)"
              ? await tryHumanizeNews(brief)
              : body.kind === "Verkehr (faktengetreu umformulieren)"
                ? await tryHumanizeTraffic(brief)
                : body.kind === "Blitzer-Service (faktengetreu umformulieren)"
                  ? await tryHumanizeBlitzer(brief, body.hostName)
                  : await generateModerationText({
                      kind: body.kind,
                      hostName: body.hostName,
                      brief,
                    });
          return Response.json({ text });
        } catch (err) {
          if (err instanceof AiError) {
            return Response.json({ error: err.message }, { status: err.status });
          }
          return Response.json({ error: "Textgenerierung fehlgeschlagen." }, { status: 502 });
        }
      },
    },
  },
});
