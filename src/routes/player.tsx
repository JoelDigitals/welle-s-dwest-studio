import { createFileRoute } from "@tanstack/react-router";
import { Pause, Play } from "lucide-react";
import { useLiveBroadcast } from "@/lib/use-live-broadcast";

const TITLE = "Welle Südwest – Webplayer zum Einbinden";
const DESCRIPTION =
  "Live-Webplayer von Welle Südwest mit aktueller Sendung, Moderation und laufendem Titel für Saarland und Rheinland-Pfalz.";

export const Route = createFileRoute("/player")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Player,
});

/** Läuft gerade Musik, zeigt die Laufschrift "Titel -- Künstler -- Welle Süd-West -- " (und
 *  wiederholt sich von vorne). Läuft gerade ein echtes Mikrofon-Segment, zeigt sie den vom
 *  Bediener selbst gesetzten Titel (kein Dateiname/Interpret vorhanden). Bei allem anderen
 *  (Zwischenansagen, Nachrichten, Werbung, ...) steht nur der Sendername da – niemand braucht
 *  den Wortlaut einer Ansage als Laufschrift. */
function tickerText(kind: string | null | undefined, title: string | null, subtitle: string | null) {
  if (kind === "music" && title) {
    const artist = subtitle?.split(" · ")[0]?.trim();
    return artist ? `${title} -- ${artist} -- Welle Süd-West -- ` : `${title} -- Welle Süd-West -- `;
  }
  if (kind === "mic" && title) {
    return `${title} -- Welle Süd-West -- `;
  }
  return "Welle Süd-West -- ";
}

function Player() {
  const { nowPlaying: state, playing, setPlaying, joinError, stream } = useLiveBroadcast();
  const text = tickerText(state?.kind, state?.title ?? null, state?.subtitle ?? null);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <style>{`
        @keyframes ws-ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      `}</style>
      <section className="panel flex w-full max-w-2xl items-center gap-4 p-4">
        <button
          type="button"
          aria-label={playing ? "Pause" : "Wiedergabe starten"}
          onClick={() => setPlaying((p) => !p)}
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          {playing ? <Pause className="size-6" /> : <Play className="size-6" />}
        </button>

        <div className="min-w-0 flex-1 overflow-hidden">
          <div
            className="flex w-max whitespace-nowrap text-lg font-medium"
            style={{ animation: "ws-ticker 11s linear infinite" }}
          >
            <span className="pr-0">{text}</span>
            <span aria-hidden="true">{text}</span>
          </div>
        </div>
      </section>

      {playing && stream && <audio src={stream} autoPlay className="hidden" />}
      {playing && !stream && !state?.onAir && (
        <p className="mx-auto mt-3 max-w-2xl text-center text-xs text-muted-foreground">
          Sender startet gerade – bitte einen Moment Geduld.
        </p>
      )}
      {playing && !stream && joinError && (
        <p className="mx-auto mt-3 max-w-2xl text-center text-xs text-destructive">{joinError}</p>
      )}
    </main>
  );
}
