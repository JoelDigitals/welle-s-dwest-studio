import { useMemo, useState } from "react";
import { Loader2, Newspaper, Play, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { HOSTS } from "@/lib/radio-config";
import { speakDuration } from "@/lib/planner";
import { manualItem } from "@/lib/use-radio-engine";
import type {
  HotlineReport,
  NewsFeedItem,
  PlanItem,
  Report,
  TrafficFeedItem,
} from "@/lib/broadcast-types";

type Selected = { id: string; region: string; headline: string; body: string; reason?: string };

type Props = {
  news: NewsFeedItem[];
  traffic: TrafficFeedItem[];
  hotline: HotlineReport[];
  reports: Report[];
  refetch: () => void;
  playNow: (item: PlanItem) => void;
  cueNext: (item: PlanItem) => void;
};

const REGIONS = ["Saarland", "Rheinland-Pfalz", "Deutschland", "Welt"] as const;
const LABEL: Record<string, string> = {
  Saarland: "Saarland",
  "Rheinland-Pfalz": "Rheinland-Pfalz",
  Deutschland: "Deutschland",
  Welt: "Welt",
};

export function NewsroomPanel(props: Props) {
  const [mode, setMode] = useState<"full" | "short">("full");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selected[]>([]);
  const [script, setScript] = useState("");
  const host = HOSTS[0];

  /** Alle Quellen laufen im Newsroom zusammen: Feeds, Redaktion, Live-Hotline. */
  const pool = useMemo(() => {
    const feed = props.news.map((n) => ({
      id: n.id,
      region: n.region as string,
      headline: n.headline,
      body: n.body,
      origin: "Feed",
    }));
    const editorial = props.reports
      .filter((r) => r.approved)
      .map((r) => ({
        id: r.id,
        region: r.region as string,
        headline: r.title,
        body: `${r.body} (Bericht von ${r.author})`,
        origin: "Redaktion",
      }));
    const live = props.hotline.slice(0, 6).map((h) => ({
      id: h.id,
      region: h.region as string,
      headline: `${h.type === "blitzer" ? "Blitzer" : "Verkehr"}: ${h.place}`,
      body: `${h.road ? `${h.road}. ` : ""}${h.message}`,
      origin: "Live-Hotline",
    }));
    const traffic = props.traffic.slice(0, 6).map((t) => ({
      id: t.id,
      region: t.region as string,
      headline: t.headline,
      body: t.message,
      origin: "Verkehr",
    }));
    return [...feed, ...editorial, ...live, ...traffic];
  }, [props.news, props.reports, props.hotline, props.traffic]);

  async function decide() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/newsroom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          hostName: host.name,
          headlines: pool.map((p) => ({
            id: p.id,
            region: p.region,
            headline: p.headline,
            body: p.body,
          })),
        }),
      });
      const data = (await res.json()) as {
        selection?: Selected[];
        script?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
      setSelection(data.selection ?? []);
      setScript(data.script ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auswahl fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  const item = () =>
    manualItem({
      kind: "news",
      title: mode === "full" ? "Nachrichten (Newsroom)" : "Kurznachrichten (Newsroom)",
      subtitle: `${host.name} · KI-Auswahl`,
      text: script,
      voice: host.voice,
      duration: speakDuration(script),
    });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="display flex items-center gap-2 text-xl">
            <Newspaper className="size-5 text-primary" /> Newsroom ({pool.length})
          </h3>
          <Button size="sm" variant="ghost" onClick={props.refetch}>
            <RefreshCw className="size-4" /> Aktualisieren
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Alle Meldungen aus Saarland, Rheinland-Pfalz, Deutschland und der Welt laufen hier
          zusammen – dazu Redaktionsberichte und Live-Meldungen aus der Hörer-Hotline. Die KI
          entscheidet daraus, was in die Nachrichten kommt.
        </p>
        <div className="max-h-[30rem] space-y-3 overflow-y-auto pr-1">
          {REGIONS.map((region) => {
            const list = pool.filter((p) => p.region === region);
            return (
              <div key={region} className="space-y-1.5">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  {LABEL[region]} · {list.length}
                </p>
                {list.length === 0 && (
                  <p className="text-sm text-muted-foreground">Keine Meldungen.</p>
                )}
                {list.map((p) => (
                  <div
                    key={`${p.origin}-${p.id}`}
                    className="rounded-lg border border-border bg-secondary/40 px-3 py-2"
                  >
                    <p className="text-sm font-semibold">{p.headline}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {p.origin} · {p.body}
                    </p>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel space-y-3 p-5">
        <h3 className="display text-xl">Nachrichtenlage bestimmen</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={mode === "full" ? "default" : "secondary"}
            onClick={() => setMode("full")}
          >
            Volle Stunde · ausführlich
          </Button>
          <Button
            size="sm"
            variant={mode === "short" ? "default" : "secondary"}
            onClick={() => setMode("short")}
          >
            Halbe Stunde · kompakt
          </Button>
        </div>
        <Button onClick={decide} disabled={loading || pool.length === 0}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          KI wählt die Nachrichten aus
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {selection.length > 0 && (
          <ol className="space-y-1.5">
            {selection.map((s, i) => (
              <li key={`${s.id}-${i}`} className="rounded-lg border border-border px-3 py-2">
                <p className="text-sm font-semibold">
                  {i + 1}. {s.headline}
                </p>
                <p className="text-xs text-muted-foreground">
                  {LABEL[s.region] ?? s.region}
                  {s.reason ? ` · ${s.reason}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}

        {script && (
          <>
            <Textarea rows={12} value={script} onChange={(e) => setScript(e.target.value)} />
            <div className="flex gap-2">
              <Button onClick={() => props.playNow(item())}>
                <Play className="size-4" /> Sofort senden
              </Button>
              <Button variant="secondary" onClick={() => props.cueNext(item())}>
                Als Nächstes
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}