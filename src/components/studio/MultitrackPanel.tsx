import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Layers, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

type Track = "music" | "voice" | "fx";

type TimelineItem = {
  uid: string;
  start: string;
  duration_s: number;
  kind: string;
  title: string;
  subtitle: string;
  speaker: string | null;
  hard_start: string | null;
  track: Track;
  overlap_s: number;
  overlap_auto: boolean;
  overlap_blocked: string | null;
  bed: { title: string } | null;
  mixed: boolean;
  current: boolean;
  text: string | null;
  traffic_jingle_after_announcement: boolean;
  meta: { editor_needed: boolean; tts?: boolean };
};

type Timeline = { mode: string; current_started_at: string | null; timeline: TimelineItem[] };

const LANES: Array<{ id: Track | "bed"; label: string; className: string }> = [
  { id: "music", label: "Musik", className: "border-primary/60 bg-primary/25" },
  { id: "voice", label: "Sprache", className: "border-sky-500/60 bg-sky-500/25" },
  { id: "fx", label: "Jingle / FX", className: "border-amber-500/60 bg-amber-500/25" },
  { id: "bed", label: "Bett", className: "border-emerald-500/60 bg-emerald-500/25" },
];

const WINDOWS = [10, 30, 60] as const;

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Berlin",
  });

/**
 * Mehrspur-Ansicht des echten Sendeplans (wie Profi-Radiosoftware): Musik, Sprache, Jingle/FX und
 * Bett als eigene Spuren auf einer Zeitleiste. Überlappungen sind sichtbar und werden von der
 * Sendemischer live gemischt (siehe live-mixer.ts), die automatische Regie entscheidet selbst. Elemente lassen sich per Drag & Drop
 * verschieben, Überlappung und Bett im Detailbereich einstellen.
 */
export function MultitrackPanel({ queue = "active" }: { queue?: "active" | "live" }) {
  const [data, setData] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [windowMin, setWindowMin] = useState<(typeof WINDOWS)[number]>(30);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragUid, setDragUid] = useState<string | null>(null);
  const [overlapDraft, setOverlapDraft] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/production?format=json${queue === "live" ? "&queue=live" : ""}`,
        { cache: "no-store" },
      );
      if (!res.ok)
        throw new Error(res.status === 401 ? "Nicht angemeldet" : `Fehler ${res.status}`);
      setData((await res.json()) as Timeline);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sendeplan nicht ladbar");
    }
  }, [queue]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), 4000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const items = useMemo(() => data?.timeline ?? [], [data]);
  const selectedItem = items.find((i) => i.uid === selected) ?? null;

  useEffect(() => {
    setOverlapDraft(selectedItem?.overlap_s ?? 0);
  }, [selectedItem?.uid, selectedItem?.overlap_s]);

  const winStart = now - 60_000;
  const winLength = windowMin * 60_000;
  const winEnd = winStart + winLength;

  const blocks = useMemo(() => {
    return items
      .map((item) => {
        const start =
          item.current && data?.current_started_at
            ? Date.parse(data.current_started_at)
            : Date.parse(item.start);
        return { item, start, end: start + item.duration_s * 1000 };
      })
      .filter((b) => b.end > winStart && b.start < winEnd);
  }, [items, data?.current_started_at, winStart, winEnd]);

  const pos = (start: number, end: number) => {
    const left = Math.max(0, ((start - winStart) / winLength) * 100);
    const right = Math.min(100, ((end - winStart) / winLength) * 100);
    return { left: `${left}%`, width: `${Math.max(0.4, right - left)}%` };
  };

  async function edit(body: Record<string, unknown>, success: string) {
    setStatus(null);
    const res = await fetch("/api/engine-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, queue }),
    }).catch(() => null);
    const result = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setStatus(result?.ok ? success : (result?.error ?? "Bearbeitung fehlgeschlagen"));
    void load();
  }

  const indexOf = (uid: string) => items.findIndex((i) => i.uid === uid);

  const moveEarlier = (item: TimelineItem) => {
    const i = indexOf(item.uid);
    if (i > 1)
      void edit({ action: "move", uid: item.uid, beforeUid: items[i - 1].uid }, "Verschoben");
  };
  const moveLater = (item: TimelineItem) => {
    const i = indexOf(item.uid);
    if (i < 0 || i >= items.length - 1) return;
    void edit(
      { action: "move", uid: item.uid, beforeUid: items[i + 2]?.uid ?? null },
      "Verschoben",
    );
  };

  const ticks = useMemo(() => {
    const step = windowMin <= 10 ? 60_000 : windowMin <= 30 ? 5 * 60_000 : 10 * 60_000;
    const first = Math.ceil(winStart / step) * step;
    const out: number[] = [];
    for (let t = first; t < winEnd; t += step) out.push(t);
    return out;
  }, [winStart, winEnd, windowMin]);

  return (
    <section className="panel space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="display flex items-center gap-2 text-xl">
          <Layers className="size-5 text-primary" />{" "}
          {queue === "live" ? "Mehrspur – Live-Warteschlange" : "Mehrspur-Sendeplan"}
          <span className="text-sm font-normal text-muted-foreground">
            (
            {queue === "live"
              ? data?.mode === "live"
                ? "sendet"
                : "vorbereitet"
              : data?.mode === "live"
                ? "Livestudio"
                : "Autopilot"}
            )
          </span>
        </h3>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w}
              size="sm"
              variant={w === windowMin ? "default" : "secondary"}
              onClick={() => setWindowMin(w)}
            >
              {w} min
            </Button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="relative ml-24 h-5 text-[10px] text-muted-foreground">
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute -translate-x-1/2"
                style={{ left: `${((t - winStart) / winLength) * 100}%` }}
              >
                {clock(t).slice(0, 5)}
              </span>
            ))}
          </div>
          {LANES.map((lane) => (
            <div key={lane.id} className="flex items-stretch border-t border-border">
              <div className="w-24 shrink-0 py-3 pr-2 text-xs font-medium text-muted-foreground">
                {lane.label}
              </div>
              <div className="relative h-14 flex-1 bg-secondary/20">
                <div
                  className="absolute inset-y-0 z-10 w-px bg-destructive"
                  style={{ left: `${((now - winStart) / winLength) * 100}%` }}
                  aria-hidden
                />
                {blocks
                  .filter(({ item }) =>
                    lane.id === "bed" ? Boolean(item.bed) : item.track === lane.id,
                  )
                  .map(({ item, start, end }) => (
                    <button
                      key={`${lane.id}-${item.uid}`}
                      type="button"
                      draggable={lane.id !== "bed" && !item.current && !item.hard_start}
                      onDragStart={() => setDragUid(item.uid)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragUid && dragUid !== item.uid) {
                          void edit(
                            { action: "move", uid: dragUid, beforeUid: item.uid },
                            "Verschoben",
                          );
                        }
                        setDragUid(null);
                      }}
                      onClick={() => setSelected(item.uid)}
                      title={`${clock(start)} · ${item.title}`}
                      className={`absolute top-1.5 bottom-1.5 overflow-hidden rounded border px-1.5 text-left text-[11px] leading-tight ${lane.className} ${
                        selected === item.uid ? "ring-2 ring-ring" : ""
                      } ${item.current ? "font-semibold" : ""} ${
                        item.meta.editor_needed ? "border-destructive" : ""
                      }`}
                      style={pos(start, end)}
                    >
                      <span className="block truncate">
                        {lane.id === "bed" ? item.bed?.title : item.title}
                      </span>
                      <span className="block truncate text-muted-foreground">
                        {item.overlap_s
                          ? `↤ ${item.overlap_s}s ${item.overlap_auto ? "auto" : ""}`
                          : ""}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Elemente per Drag &amp; Drop auf ein anderes Element ziehen, um sie davor einzureihen. Das
        laufende Element und Nachrichten-Zeitmarken bleiben fest. Überlappung und Bett gibt es nur
        für Jingles und kurze Callouts (max. 5 Wörter) – unter Nachrichten, Verkehr und Warnungen
        läuft nie Musik. Betten kommen aus der Bibliothek (Jingle, Slot „Musikbett“).
      </p>

      {selectedItem && (
        <div className="space-y-3 rounded-lg border border-border bg-secondary/30 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="font-medium">{selectedItem.title}</p>
              <p className="text-xs text-muted-foreground">
                {clock(Date.parse(selectedItem.start))} · {Math.round(selectedItem.duration_s)}s ·{" "}
                {LANES.find((l) => l.id === selectedItem.track)?.label}
                {selectedItem.speaker ? ` · ${selectedItem.speaker}` : ""}
                {selectedItem.meta.tts ? " · TTS" : ""}
                {selectedItem.traffic_jingle_after_announcement ? " · Jingle nach der Meldung" : ""}
              </p>
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="secondary"
                disabled={selectedItem.current || Boolean(selectedItem.hard_start)}
                onClick={() => moveEarlier(selectedItem)}
              >
                <ArrowLeft className="size-4" /> Früher
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={selectedItem.current || Boolean(selectedItem.hard_start)}
                onClick={() => moveLater(selectedItem)}
              >
                Später <ArrowRight className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={selectedItem.current}
                onClick={() => {
                  void edit({ action: "remove", uid: selectedItem.uid }, "Entfernt");
                  setSelected(null);
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>

          {selectedItem.text && (
            <p className="text-sm text-muted-foreground">{selectedItem.text}</p>
          )}

          {!selectedItem.current && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-medium">
                  Überlappung mit dem vorigen Element: {selectedItem.overlap_s}s (
                  {selectedItem.overlap_blocked
                    ? `gesperrt – ${selectedItem.overlap_blocked}`
                    : selectedItem.overlap_auto
                      ? "automatische Regie"
                      : "von Hand"}
                  ) · neu: {overlapDraft}s
                </p>
                <Slider
                  min={0}
                  max={8}
                  step={0.5}
                  value={[overlapDraft]}
                  onValueChange={(v) => setOverlapDraft(v[0] ?? 0)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void edit(
                      { action: "overlap", uid: selectedItem.uid, seconds: overlapDraft },
                      "Überlappung gespeichert",
                    )
                  }
                >
                  Überlappung übernehmen
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void edit(
                      { action: "overlap", uid: selectedItem.uid, seconds: null },
                      "Automatische Regie entscheidet",
                    )
                  }
                >
                  Automatisch
                </Button>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium">
                  Bett: {selectedItem.bed ? selectedItem.bed.title : "keins"}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void edit(
                      { action: "bed", uid: selectedItem.uid, on: !selectedItem.bed },
                      selectedItem.bed ? "Bett entfernt" : "Bett hinzugefügt",
                    )
                  }
                >
                  {selectedItem.bed ? "Bett entfernen" : "Bett hinzufügen"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {status && <p className="text-sm text-muted-foreground">{status}</p>}
    </section>
  );
}
