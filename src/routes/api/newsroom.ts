import { createFileRoute } from "@tanstack/react-router";
import { generateText, AiError } from "@/lib/ai-text";

type Body = {
  headlines?: Array<{ id: string; region: string; headline: string; body: string }>;
  mode?: "full" | "short";
  hostName?: string;
};

const SYSTEM = `Du bist Nachrichtenchef:in im Newsroom des Regionalradios "Welle Südwest" (Saarland und Rheinland-Pfalz).
Du bekommst eine Sammlung aktueller Meldungen aus dem Saarland, aus Rheinland-Pfalz, aus Deutschland und aus der Welt.
Wähle daraus die Nachrichtenlage für die nächste Ausgabe: relevant für Hörerinnen und Hörer in der Region, keine Dopplungen, regionale Themen zuerst, danach Deutschland und international.
Antworte ausschließlich mit gültigem JSON in dieser Form:
{"selection":[{"id":"...","region":"...","headline":"...","body":"...","reason":"..."}],"script":"..."}
"headline" ist eine gesprochene Nachrichtenzeile, "body" zwei bis drei gesprochene Sätze, "reason" ein kurzer redaktioneller Hinweis für die Redaktion.
"script" ist der fertige, sprechbare Nachrichtenblock (Anmoderation mit Themenüberblick, dann die Meldungen, dann die Absage) in gesprochener Sprache, ohne Regieanweisungen, ohne Quellen- oder Sendernamen wie ARD, SWR, SR, dpa.
Formuliere "script" jedes Mal neu: variiere Anmoderation, Übergänge und Absage, klinge lebendig und flüssig statt wie eine feste Vorlage.`;

export const Route = createFileRoute("/api/newsroom")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });
        }
        const headlines = (body.headlines ?? []).slice(0, 40);
        if (!headlines.length) {
          return Response.json({ error: "Keine Meldungen im Newsroom." }, { status: 400 });
        }
        const count = body.mode === "short" ? 10 : 7;
        const user = `Sprecher:in: ${body.hostName ?? "Redaktion"}\nAusgabe: ${
          body.mode === "short"
            ? `Kurznachrichten zur halben Stunde, ${count} kurze Meldungen`
            : `Ausführliche Nachrichten zur vollen Stunde, ${count} Meldungen mit Hintergrund`
        }\n\nMeldungen:\n${headlines
          .map((h) => `- [${h.id}] (${h.region}) ${h.headline} :: ${h.body}`)
          .join("\n")}`;

        let raw: string;
        try {
          const result = await generateText({
            system: SYSTEM,
            user,
            temperature: 1.0,
            topP: 0.95,
            json: true,
          });
          raw = result.text;
        } catch (err) {
          if (err instanceof AiError) {
            return Response.json({ error: err.message }, { status: err.status });
          }
          return Response.json({ error: "Newsroom-Auswahl fehlgeschlagen." }, { status: 502 });
        }

        try {
          const parsed = JSON.parse(raw.replace(/^```json|```$/g, "").trim()) as {
            selection?: unknown;
            script?: unknown;
          };
          return Response.json({
            selection: Array.isArray(parsed.selection) ? parsed.selection : [],
            script: typeof parsed.script === "string" ? parsed.script : "",
          });
        } catch {
          return Response.json({ selection: [], script: raw });
        }
      },
    },
  },
});
