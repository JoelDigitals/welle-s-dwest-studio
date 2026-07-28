import { createFileRoute } from "@tanstack/react-router";
import { subscribeLive } from "@/lib/server/station-engine";

/**
 * Eigener kostenloser Dauer-Stream – kein externer Icecast-/Streaming-Anbieter nötig. Liefert
 * durchgehend gültiges MP3, gespeist live aus der Server-Sende-Engine. Kann direkt in einem
 * <audio>-Tag, VLC, einer Radio-App oder als Quelle für einen echten Icecast-Server verwendet
 * werden (URL z. B. auch im Studio unter "Ausgabe" als Stream-URL eintragen).
 *
 * Bewusst ohne Dateiendung (kein "/live.mp3"): Vite behandelt .mp3/.aac/.wav/... im Dev-Server
 * als bekannte Asset-Endung und fängt solche Requests vor unserem Route-Handler ab (404, egal auf
 * welcher Verzeichnisebene) – im Produktions-Build (reines Nitro) wäre das kein Problem, aber im
 * Dev-Server schon. Echte Webradio-Mountpoints sind ohnehin meist ohne Dateiendung (z. B.
 * "/stream"); Player erkennen MP3 am Content-Type, nicht an der URL-Endung.
 */
export const Route = createFileRoute("/live-stream")({
  server: {
    handlers: {
      GET: async () => {
        const stream = subscribeLive();
        return new Response(stream, {
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store, no-transform",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "icy-name": "Welle Suedwest",
            "icy-description": "Saarland und Rheinland-Pfalz",
            "icy-genre": "Pop",
          },
        });
      },
    },
  },
});
