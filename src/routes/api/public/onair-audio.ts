import { createFileRoute } from "@tanstack/react-router";
import {
  getAudioByUid,
  getCurrentAudio,
  startStationEngine,
} from "@/lib/server/station-engine";

startStationEngine();

/**
 * Liefert das Audio des Sendeplan-Elements, das die autonome Server-Engine gerade "on air" hat.
 * Für den Webplayer, wenn keine externe Icecast-Stream-URL hinterlegt ist ("live einsteigen").
 *
 * Mit ?uid=<kommendes Element> lässt sich auch ein bereits vorbereitetes, noch nicht aktuelles
 * Element abrufen (für die clientseitige Überblendung: das nächste Element wird kurz vorher
 * schon geladen, damit es überlappend statt hart geschnitten starten kann). Ohne uid oder mit der
 * uid des aktuellen Elements verhält sich die Route wie bisher.
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};

export const Route = createFileRoute("/api/public/onair-audio")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const wantUid = new URL(request.url).searchParams.get("uid");
        const current = getCurrentAudio();

        if (wantUid && current && wantUid !== current.uid) {
          const upcoming = getAudioByUid(wantUid);
          if (upcoming) {
            return new Response(new Uint8Array(upcoming.buffer), {
              headers: { ...cors, "Content-Type": upcoming.contentType, "X-Onair-Uid": upcoming.uid },
            });
          }
        }

        if (!current) {
          return Response.json(
            { error: "Noch kein Audio bereit." },
            { status: 425, headers: cors },
          );
        }
        if (wantUid && wantUid !== current.uid) {
          return Response.json(
            { error: "Element hat gewechselt, bitte Now-Playing neu abrufen." },
            { status: 409, headers: cors },
          );
        }
        return new Response(new Uint8Array(current.buffer), {
          headers: { ...cors, "Content-Type": current.contentType, "X-Onair-Uid": current.uid },
        });
      },
    },
  },
});
