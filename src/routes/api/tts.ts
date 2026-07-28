import { createFileRoute } from "@tanstack/react-router";
import { synthesizeSpeech } from "@/lib/server/tts-synthesize";

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: { text?: unknown; voice?: unknown; style?: unknown };
        try {
          payload = await request.json();
        } catch {
          return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });
        }

        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        const voiceId =
          typeof payload.voice === "string" && payload.voice ? payload.voice : "alloy";
        const style = typeof payload.style === "string" ? payload.style : "";
        if (!text) {
          return Response.json({ error: "Kein Sprechtext übergeben." }, { status: 400 });
        }

        try {
          const { buffer, contentType } = await synthesizeSpeech(text, voiceId, style);
          return new Response(new Uint8Array(buffer), {
            headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
          });
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          return Response.json(
            {
              error:
                `Sprachausgabe fehlgeschlagen (Gemini und Fallback nicht verfügbar). ${detail}`.trim(),
            },
            { status: 502 },
          );
        }
      },
    },
  },
});
