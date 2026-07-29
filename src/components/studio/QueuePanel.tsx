import {
  Trash2,
  Music,
  Megaphone,
  Newspaper,
  TrafficCone,
  Sparkles,
  Disc3,
  CloudSun,
  Radio,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Mic,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/radio-data";
import type { ItemKind, PlanItem } from "@/lib/broadcast-types";

const ICONS: Record<ItemKind, typeof Music> = {
  music: Music,
  jingle: Disc3,
  news: Newspaper,
  traffic: TrafficCone,
  ad: Megaphone,
  moderation: Sparkles,
  weather: CloudSun,
  showopener: Radio,
  slogan: Sparkles,
  recording: Mic,
};

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

function Status({ item }: { item: PlanItem }) {
  if (item.status === "ready")
    return <CheckCircle2 className="size-4 shrink-0 text-signal" aria-label="Audio bereit" />;
  if (item.status === "preparing")
    return (
      <Loader2
        className="size-4 shrink-0 animate-spin text-primary"
        aria-label="Audio wird erzeugt"
      />
    );
  if (item.status === "error")
    return <AlertTriangle className="size-4 shrink-0 text-destructive" aria-label="Fehler" />;
  return (
    <span className="size-4 shrink-0 rounded-full border border-border" aria-label="Geplant" />
  );
}

export function QueuePanel({
  queue,
  onRemove,
  onRegenerate,
  onExtend,
  limit = 60,
  readOnly = false,
}: {
  queue: PlanItem[];
  onRemove: (id: string) => void;
  onRegenerate?: () => void;
  onExtend?: () => void;
  limit?: number;
  /** Zeigt die echte, laufende Sendung – Bearbeiten/Neu-Planen ergibt hier keinen Sinn. */
  readOnly?: boolean;
}) {
  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="display text-xl">{readOnly ? "Sendeplan (live)" : "Sendeplan"}</h3>
        {!readOnly && (
          <div className="flex gap-2">
            {onExtend && (
              <Button variant="ghost" size="sm" onClick={onExtend}>
                +15 min
              </Button>
            )}
            {onRegenerate && (
              <Button variant="secondary" size="sm" onClick={onRegenerate}>
                Neu planen
              </Button>
            )}
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {readOnly
          ? `${queue.length} Elemente – genau das, was gerade wirklich gesendet wird`
          : `${queue.length} Elemente geplant · Audio wird vor dem Abspielen erzeugt`}
      </p>
      <ul className="mt-4 max-h-[70vh] space-y-2 overflow-y-auto pr-1">
        {queue.slice(0, limit).map((item, index) => {
          const Icon = ICONS[item.kind];
          return (
            <li
              key={item.uid}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                index === 0 ? "border-primary bg-primary/10" : "border-border bg-secondary/40"
              }`}
            >
              <Status item={item} />
              <Icon className="size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{item.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {clock(item.plannedAt)} · {item.subtitle}
                  {item.fromCache && item.text ? " · aus Cache" : ""}
                  {item.kind === "music" && item.introSeconds
                    ? ` · ${item.introSeconds}s bis Gesang`
                    : ""}
                </p>
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatClock(item.duration)}
              </span>
              {index > 0 && !readOnly && (
                <Button variant="ghost" size="icon" onClick={() => onRemove(item.uid)}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
