import { useState } from "react";
import { Loader2, Play, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HOSTS } from "@/lib/radio-config";
import { speakDuration } from "@/lib/planner";
import { manualItem } from "@/lib/use-radio-engine";
import type { NewsFeedItem, PlanItem, Report, TrafficFeedItem } from "@/lib/broadcast-types";

type Props = {
  playNow: (item: PlanItem) => void;
  cueNext: (item: PlanItem) => void;
  news: NewsFeedItem[];
  traffic: TrafficFeedItem[];
  newsError?: string | null;
  trafficError?: string | null;
  refetch: () => void;
  reports: Report[];
  addReport: (r: Omit<Report, "id" | "createdAt">) => void;
  removeReport: (id: string) => void;
};

export function NewsPanel(props: Props) {
  const [hostId, setHostId] = useState("h5");
  const [kind, setKind] = useState("Nachrichtenblock");
  const [brief, setBrief] = useState("");
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState({ author: "", title: "", body: "", region: "Saarland" });

  const host = HOSTS.find((h) => h.id === hostId) ?? HOSTS[0];

  const feedBrief = [
    ...props.news.map((n) => `${n.region} (${n.source}): ${n.headline} – ${n.body}`),
    ...props.traffic.slice(0, 5).map((t) => `Verkehr ${t.road}: ${t.message || t.headline}`),
  ].join("\n");

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, brief: brief.trim() || feedBrief, hostName: host.name }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
      setScript(data.text ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generierung fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  const scriptItem = () =>
    manualItem({
      kind: "news",
      title: kind,
      subtitle: `${host.name} · KI-Stimme`,
      text: script,
      voice: host.voice,
      duration: speakDuration(script),
    });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="display text-xl">Redaktion — Sprechtext generieren</h3>
          <Button size="sm" variant="ghost" onClick={props.refetch}>
            <RefreshCw className="size-4" /> Feeds
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">
              Beitragsart
            </Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Nachrichtenblock", "Verkehrsmeldung", "Wetter", "Moderation", "Werbetext"].map(
                  (k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">
              Sprecher:in
            </Label>
            <Select value={hostId} onValueChange={setHostId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOSTS.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Textarea
          rows={5}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={feedBrief.slice(0, 400) || "Briefing / Meldungen…"}
        />
        <Button onClick={generate} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Sprechtext schreiben lassen
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {script && (
          <>
            <Textarea rows={6} value={script} onChange={(e) => setScript(e.target.value)} />
            <div className="flex gap-2">
              <Button onClick={() => props.playNow(scriptItem())}>
                <Play className="size-4" /> Sofort senden
              </Button>
              <Button variant="secondary" onClick={() => props.cueNext(scriptItem())}>
                Als Nächstes
              </Button>
            </div>
          </>
        )}
      </section>

      <div className="space-y-4">
        <section className="panel space-y-3 p-5">
          <h3 className="display text-xl">Live-Feeds</h3>
          {props.newsError && (
            <p className="text-sm text-destructive">Nachrichten: {props.newsError}</p>
          )}
          {props.trafficError && (
            <p className="text-sm text-destructive">Verkehr: {props.trafficError}</p>
          )}
          <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
            {props.news.map((n) => (
              <div key={n.id} className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
                <p className="text-sm font-semibold">{n.headline}</p>
                <p className="text-xs text-muted-foreground">
                  {n.region} · {n.source}
                </p>
              </div>
            ))}
          </div>
          <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
            {props.traffic.map((t) => (
              <div key={t.id} className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
                <p className="text-sm font-semibold">
                  {t.road} · {t.region}
                </p>
                <p className="text-xs text-muted-foreground">{t.message || t.headline}</p>
              </div>
            ))}
            {props.traffic.length === 0 && (
              <p className="text-sm text-muted-foreground">Keine aktuellen Verkehrsmeldungen.</p>
            )}
          </div>
        </section>

        <section className="panel space-y-3 p-5">
          <h3 className="display text-xl">Berichte der Redaktion</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              placeholder="Autor:in"
              value={report.author}
              onChange={(e) => setReport({ ...report, author: e.target.value })}
            />
            <Select
              value={report.region}
              onValueChange={(v) => setReport({ ...report, region: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Saarland", "Rheinland-Pfalz", "Welt"].map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            placeholder="Titel"
            value={report.title}
            onChange={(e) => setReport({ ...report, title: e.target.value })}
          />
          <Textarea
            rows={3}
            placeholder="Beitragstext"
            value={report.body}
            onChange={(e) => setReport({ ...report, body: e.target.value })}
          />
          <Button
            disabled={!report.title.trim() || !report.body.trim()}
            onClick={() => {
              props.addReport({
                author: report.author.trim() || "Redaktion",
                title: report.title.trim(),
                body: report.body.trim(),
                region: report.region as Report["region"],
                approved: true,
              });
              setReport({ author: report.author, title: "", body: "", region: report.region });
            }}
          >
            Bericht freigeben & einplanen
          </Button>

          <ul className="space-y-1.5">
            {props.reports.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.region} · {r.author}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => props.removeReport(r.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
