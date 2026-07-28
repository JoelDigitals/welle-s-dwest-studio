import { createFileRoute } from "@tanstack/react-router";
import { AiError } from "@/lib/ai-text";
import { generateModerationText } from "@/lib/server/moderation-text";

type Body = {
  kind?: string;
  brief?: string;
  hostName?: string;
};

export const Route = createFileRoute("/api/script")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
          const text = await generateModerationText({
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
