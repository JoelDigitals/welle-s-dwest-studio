import { Activity } from "lucide-react";
import { formatClock } from "@/lib/radio-data";
import type { LogEntry, PlanItem } from "@/lib/broadcast-types";

export function DashboardPanel({
  log,
  outputLevel,
  micLevel,
  playing,
  live,
  current,
  planCount,
  readyCount,
  totalPlanned,
}: {
  log: LogEntry[];
  outputLevel: number;
  micLevel: number;
  playing: boolean;
  live: boolean;
  current: PlanItem | null;
  planCount: number;
  readyCount: number;
  totalPlanned: number;
}) {
  const stats = [
    { label: "Status", value: playing ? (live ? "LIVE" : "ON AIR") : "STANDBY" },
    { label: "Elemente", value: String(planCount) },
    { label: "Audio bereit", value: String(readyCount) },
    { label: "Sendezeit", value: formatClock(totalPlanned) },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel space-y-4 p-5">
        <h3 className="display flex items-center gap-2 text-xl">
          <Activity className="size-5 text-primary" /> Broadcast-Status
        </h3>
        <dl className="grid grid-cols-2 gap-2 text-center">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-secondary/40 p-3">
              <dt className="text-xs uppercase tracking-widest text-muted-foreground">{s.label}</dt>
              <dd className="display text-2xl">{s.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">
          Aktuell: <span className="text-foreground">{current?.title ?? "—"}</span>
        </p>
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Ausgangspegel</p>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width] duration-75"
              style={{ width: `${Math.round(outputLevel * 100)}%` }}
            />
          </div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Mikrofon</p>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-signal transition-[width] duration-75"
              style={{ width: `${Math.round(micLevel * 100)}%` }}
            />
          </div>
        </div>
      </section>

      <section className="panel space-y-3 p-5">
        <h3 className="display text-xl">Sende- & Fehlerprotokoll</h3>
        <ul className="max-h-[26rem] space-y-1 overflow-y-auto pr-1 font-mono text-xs">
          {log.map((l) => (
            <li
              key={l.id}
              className={
                l.level === "error"
                  ? "text-destructive"
                  : l.level === "warn"
                    ? "text-signal"
                    : "text-muted-foreground"
              }
            >
              {new Date(l.at).toLocaleTimeString("de-DE")} · {l.message}
            </li>
          ))}
          {log.length === 0 && <li className="text-muted-foreground">Noch keine Ereignisse.</li>}
        </ul>
      </section>
    </div>
  );
}
