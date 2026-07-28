import { Mic, Pause, Play, Radio, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatClock } from "@/lib/radio-data";

const KIND_LABEL: Record<string, string> = {
  music: "Musik",
  jingle: "Jingle",
  news: "Nachrichten",
  traffic: "Verkehr",
  ad: "Werbung",
  moderation: "Moderation",
};

/** Nur die Felder, die OnAirBar tatsächlich anzeigt – egal ob lokale Simulation oder echte Sendung. */
type OnAirItem = { kind: string; title: string; subtitle: string; duration: number };

type Props = {
  current: OnAirItem | null;
  elapsed: number;
  playing: boolean;
  live: boolean;
  speaking: boolean;
  onToggle: () => void;
  onNext: () => void;
};

export function OnAirBar({ current, elapsed, playing, live, speaking, onToggle, onNext }: Props) {
  const pct = current ? Math.min(100, (elapsed / current.duration) * 100) : 0;

  return (
    <section className="panel p-5 md:p-6">
      <div className="flex flex-wrap items-center gap-4">
        <span
          className={`onair-badge inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold tracking-widest ${
            playing ? "bg-onair text-destructive-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          <Radio className="size-4" /> ON AIR
        </span>
        {live && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground">
            <Mic className="size-3.5" /> LIVE-SENDUNG
          </span>
        )}
        {speaking && (
          <span className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">
            KI-Stimme spricht
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={onToggle} size="lg" className="font-semibold">
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            {playing ? "Sendung pausieren" : "Sendung starten"}
          </Button>
          <Button onClick={onNext} variant="secondary" size="lg">
            <SkipForward className="size-4" /> Nächstes
          </Button>
        </div>
      </div>

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          {current ? KIND_LABEL[current.kind] : "Kein Element"}
        </p>
        <h2 className="display mt-1 text-3xl md:text-4xl">{current?.title ?? "Sendeplan leer"}</h2>
        <p className="text-sm text-muted-foreground">{current?.subtitle ?? "—"}</p>
        <Progress value={pct} className="mt-3 h-2" />
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>{formatClock(elapsed)}</span>
          <span>{current ? formatClock(current.duration) : "0:00"}</span>
        </div>
      </div>
    </section>
  );
}
