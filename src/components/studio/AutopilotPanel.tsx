import {
  Bot,
  CalendarClock,
  Eraser,
  Megaphone,
  Newspaper,
  Timer,
  TrafficCone,
  CloudSun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatClock } from "@/lib/radio-data";
import { HOSTS, SHOWS, SPONSORS, hostById } from "@/lib/radio-config";
import { upcomingShows } from "@/lib/planner";

export function AutopilotPanel({
  autopilot,
  setAutopilot,
  totalPlanned,
  planCount,
  readyCount,
  regenerate,
  extendPlan,
  clearPlan,
  prunePast,
}: {
  autopilot: boolean;
  setAutopilot: (v: boolean) => void;
  totalPlanned: number;
  planCount: number;
  readyCount: number;
  regenerate: () => void;
  extendPlan: () => void;
  clearPlan: () => void;
  prunePast: () => void;
}) {
  const next = upcomingShows(new Date(), 6);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel space-y-5 p-5">
        <div className="flex items-center justify-between">
          <h3 className="display flex items-center gap-2 text-xl">
            <Bot className="size-5 text-primary" /> Autopilot
          </h3>
          <div className="flex items-center gap-2">
            <Label htmlFor="ap" className="text-xs uppercase tracking-widest">
              Aktiv
            </Label>
            <Switch id="ap" checked={autopilot} onCheckedChange={setAutopilot} />
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Der Autopilot plant nach Stundenuhr: Jingle, Nachrichten, Verkehr, Wetter, Werbung,
          Slogans und Musik – passend zur laufenden 4-Stunden-Sendung. Alle Sprechtexte werden vorab
          als Audio erzeugt.
        </p>

        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-border bg-secondary/40 p-3">
            <dt className="text-xs uppercase tracking-widest text-muted-foreground">Elemente</dt>
            <dd className="display text-2xl">{planCount}</dd>
          </div>
          <div className="rounded-lg border border-border bg-secondary/40 p-3">
            <dt className="text-xs uppercase tracking-widest text-muted-foreground">Sendezeit</dt>
            <dd className="display text-2xl">{formatClock(totalPlanned)}</dd>
          </div>
          <div className="rounded-lg border border-border bg-secondary/40 p-3">
            <dt className="text-xs uppercase tracking-widest text-muted-foreground">
              Audio bereit
            </dt>
            <dd className="display text-2xl">{readyCount}</dd>
          </div>
        </dl>

        <div className="grid grid-cols-2 gap-2">
          <Button onClick={regenerate}>Sendeplan neu berechnen</Button>
          <Button variant="secondary" onClick={extendPlan}>
            <CalendarClock className="size-4" /> 15 Minuten anhängen
          </Button>
          <Button variant="secondary" onClick={prunePast}>
            <Timer className="size-4" /> Vergangenes entfernen
          </Button>
          <Button variant="destructive" onClick={clearPlan}>
            <Eraser className="size-4" /> Gesamten Plan löschen
          </Button>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Sponsoren</p>
          {SPONSORS.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              Noch keine Sponsoren und keine freigegebene Werbung – es laufen keine Werbe- oder
              Sponsorenansagen.
            </p>
          )}
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {SPONSORS.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                {s.slot === "wetter" ? (
                  <CloudSun className="size-4" />
                ) : s.slot === "verkehr" ? (
                  <TrafficCone className="size-4" />
                ) : (
                  <Newspaper className="size-4" />
                )}
                <span className="capitalize">{s.slot}</span> — {s.name}
              </li>
            ))}
            <li className="flex items-center gap-2">
              <Megaphone className="size-4" /> Werbeblöcke aus der Medienbibliothek
            </li>
          </ul>
        </div>
      </section>

      <section className="panel space-y-4 p-5">
        <h3 className="display text-xl">Sendungen im 4-Stunden-Raster</h3>
        <ul className="space-y-2">
          {next.map((s) => (
            <li
              key={s.start.toISOString()}
              className="rounded-lg border border-border bg-secondary/40 px-3 py-2"
            >
              <p className="text-sm font-semibold">
                {s.title} mit {s.host}
              </p>
              <p className="text-xs text-muted-foreground">
                {s.start.toLocaleString("de-DE", {
                  weekday: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                –{" "}
                {new Date(s.start.getTime() + 4 * 3600_000).toLocaleTimeString("de-DE", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                Uhr · {s.colour}
              </p>
            </li>
          ))}
        </ul>

        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            10 Moderator:innen
          </p>
          <ul className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            {HOSTS.map((h) => (
              <li key={h.id}>
                <span className="text-foreground">{h.name}</span> · {h.humor}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Formate</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {SHOWS.map((s) => (
              <li key={s.id}>
                {String(s.startHour).padStart(2, "0")}:00 — {s.title} (Mo–Fr{" "}
                {hostById(s.weekdayHostId).name}, Sa/So {hostById(s.weekendHostId).name})
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
