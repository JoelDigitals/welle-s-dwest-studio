import { createFileRoute } from "@tanstack/react-router";
import { Pause, Play, Radio } from "lucide-react";
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

const KIND_LABEL: Record<string, string> = {
  music: "Musik",
  news: "Nachrichten",
  traffic: "Verkehr",
  weather: "Wetter",
  ad: "Werbung",
  jingle: "Jingle",
  slogan: "Station-ID",
  moderation: "Moderation",
  showopener: "Sendungsstart",
};

function Player() {
  const { nowPlaying: state, playing, setPlaying, joinError, stream } = useLiveBroadcast();

  return (
    <main className="min-h-dvh bg-background p-4 text-foreground">
      <section className="panel mx-auto flex max-w-2xl items-center gap-4 p-4">
        <button
          type="button"
          aria-label={playing ? "Pause" : "Wiedergabe starten"}
          onClick={() => setPlaying((p) => !p)}
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          {playing ? <Pause className="size-6" /> : <Play className="size-6" />}
        </button>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Radio className="size-3.5 text-primary" />
            {state?.station ?? "Welle Südwest"}
            {state?.onAir && <span className="text-signal">● On Air</span>}
          </p>
          <h1 className="display truncate text-2xl leading-tight">
            {state?.title ?? "Welle Südwest – Saarland & Rheinland-Pfalz"}
          </h1>
          <p className="truncate text-sm text-muted-foreground">
            {state?.kind ? `${KIND_LABEL[state.kind] ?? state.kind} · ` : ""}
            {state?.subtitle ?? "Musik, Nachrichten und Verkehr aus der Region"}
          </p>
          {state?.host && (
            <p className="truncate text-xs text-muted-foreground">Moderation: {state.host}</p>
          )}
          {state?.next?.length ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              Als Nächstes: {state.next[0].title}
            </p>
          ) : null}
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
