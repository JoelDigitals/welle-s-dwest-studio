import { useState } from "react";
import { Loader2, Play, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { speakDuration } from "@/lib/planner";
import { manualItem } from "@/lib/use-radio-engine";
import type { HotlineReport, NewsFeedItem, PlanItem, TrafficFeedItem } from "@/lib/broadcast-types";

type Props = {
  news: NewsFeedItem[];
  traffic: TrafficFeedItem[];
  hotline: HotlineReport[];
  newsError?: string | null;
  trafficError?: string | null;
  refetch: () => void;
  playNow: (item: PlanItem) => void;
  cueNext: (item: PlanItem) => void;
};

/** Formatierung eines Zeitstempels (ISO-String oder ms) als Uhrzeit HH:MM – die Daten der Feeds
 *  kommen teils als ISO-String (publishedAt/since), teils als Zahl (createdAt der Hotline). */
function clockOf(input: string | number): string {
  const ms = typeof input === "number" ? input : new Date(input).getTime();
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

/** Gemeinsamer State für eine Sektion (Nachrichten/Verkehr/Blitzer): generierter Sprechtext
 *  landet editierbar in einer Textarea – erzeugt per /api/script mit dem zur Sektion passenden
 *  faktentreuen Prompt, damit die gleichen Stimmen wie im Live-Betrieb entstehen. */
function useScript() {
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: string, brief: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, brief }),
      });
      const data = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? `Fehler ${res.status}`);
      setScript(data?.text ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generierung fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  return { script, setScript, loading, error, run };
}

export function TextStudioPanel(props: Props) {
  const newsScript = useScript();
  const trafficScript = useScript();
  const blitzerScript = useScript();

  const newsBrief = props.news
    .map((n) => `${n.region} (${n.source}): ${n.headline} – ${n.body}`)
    .join("\n");

  const trafficBrief = props.traffic
    .slice(0, 8)
    .map((t) => `Verkehr ${t.road} (${t.region}): ${t.message || t.headline}`)
    .join("\n");

  const blitzers = props.hotline.filter((h) => h.type === "blitzer").slice(0, 8);
  const blitzerBrief = blitzers
    .map(
      (h) =>
        `${h.region === "Saarland" ? "Im Saarland" : "In Rheinland-Pfalz"}: ${
          h.road ? `${h.road}, ` : ""
        }${h.place}${h.message ? `, ${h.message.replace(/[.!?]+$/, "")}` : ""}`,
    )
    .join(". ");

  const scriptItem = (kind: PlanItem["kind"], title: string, text: string): PlanItem =>
    manualItem({
      kind,
      title,
      subtitle: "Text-Studio",
      text,
      duration: speakDuration(text),
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="display text-xl">
            Text-Studio – Nachrichten, Verkehr & Blitzer im Detail
          </h3>
          <p className="text-sm text-muted-foreground">
            Links die Nachrichten mit ausführlichen Texten, rechts Staus und Behinderungen, unten
            die aktuellen Hörer-Blitzer. Jeder Block lässt sich als faktentreuer Sprechtext
            generieren und vor dem Senden bearbeiten.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={props.refetch}>
          <RefreshCw className="size-4" /> Feeds aktualisieren
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* LINKS: Nachrichten – ausführliche Texte */}
        <section className="panel space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h4 className="display text-lg">Nachrichten</h4>
            <span className="text-xs text-muted-foreground">{props.news.length} Meldungen</span>
          </div>
          {props.newsError && <p className="text-sm text-destructive">{props.newsError}</p>}
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {props.news.map((n) => (
              <article
                key={n.id}
                className="rounded-lg border border-border bg-secondary/40 px-3 py-2"
              >
                <p className="text-sm font-semibold">{n.headline}</p>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  {n.region} · {n.source}
                  {n.publishedAt ? ` · ${clockOf(n.publishedAt)}` : ""}
                </p>
                {n.body && <p className="mt-1 text-sm text-foreground/90">{n.body}</p>}
                {n.link && (
                  <a
                    href={n.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    Quelle öffnen
                  </a>
                )}
              </article>
            ))}
            {props.news.length === 0 && (
              <p className="text-sm text-muted-foreground">Keine Nachrichten abrufbar.</p>
            )}
          </div>
          <Button
            disabled={loadingOrEmpty(newsBrief, newsScript.loading)}
            onClick={() =>
              void newsScript.run("Nachrichten (faktengetreu umformulieren)", newsBrief)
            }
          >
            {newsScript.loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Nachrichten-Sprechtext generieren
          </Button>
          {newsScript.error && <p className="text-sm text-destructive">{newsScript.error}</p>}
          {newsScript.script && (
            <ScriptEditor
              value={newsScript.script}
              onChange={newsScript.setScript}
              onPlay={() =>
                props.playNow(scriptItem("news", "Nachrichten (Text-Studio)", newsScript.script))
              }
              onCue={() =>
                props.cueNext(scriptItem("news", "Nachrichten (Text-Studio)", newsScript.script))
              }
            />
          )}
        </section>

        {/* RECHTS: Verkehr – Staus/Behinderungen */}
        <section className="panel space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h4 className="display text-lg">Verkehr – Staus & Behinderungen</h4>
            <span className="text-xs text-muted-foreground">{props.traffic.length} Meldungen</span>
          </div>
          {props.trafficError && <p className="text-sm text-destructive">{props.trafficError}</p>}
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {props.traffic.map((t) => (
              <article
                key={t.id}
                className="rounded-lg border border-border bg-secondary/40 px-3 py-2"
              >
                <p className="text-sm font-semibold">
                  {t.road} · {t.region}
                </p>
                {t.message ? (
                  <p className="text-sm text-foreground/90">{t.message}</p>
                ) : (
                  <p className="text-sm text-foreground/90">{t.headline}</p>
                )}
                {t.since && (
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    seit {clockOf(t.since)}
                  </p>
                )}
              </article>
            ))}
            {props.traffic.length === 0 && (
              <p className="text-sm text-muted-foreground">Keine aktuellen Verkehrsmeldungen.</p>
            )}
          </div>
          <Button
            disabled={loadingOrEmpty(trafficBrief, trafficScript.loading)}
            onClick={() =>
              void trafficScript.run("Verkehr (faktengetreu umformulieren)", trafficBrief)
            }
          >
            {trafficScript.loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Verkehrs-Sprechtext generieren
          </Button>
          {trafficScript.error && <p className="text-sm text-destructive">{trafficScript.error}</p>}
          {trafficScript.script && (
            <ScriptEditor
              value={trafficScript.script}
              onChange={trafficScript.setScript}
              onPlay={() =>
                props.playNow(scriptItem("traffic", "Verkehr (Text-Studio)", trafficScript.script))
              }
              onCue={() =>
                props.cueNext(scriptItem("traffic", "Verkehr (Text-Studio)", trafficScript.script))
              }
            />
          )}
        </section>
      </div>

      {/* UNTEN: Blitzer – aktuelle Hörer-Meldungen */}
      <section className="panel space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h4 className="display text-lg">Blitzer – aktuelle Hörer-Meldungen</h4>
          <span className="text-xs text-muted-foreground">{blitzers.length} Meldungen</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {blitzers.map((h) => (
            <article
              key={h.id}
              className="rounded-lg border border-border bg-secondary/40 px-3 py-2"
            >
              <p className="text-sm font-semibold">
                {h.road ? `${h.road} · ` : ""}
                {h.region}
              </p>
              <p className="text-sm text-foreground/90">{h.place}</p>
              {h.message && <p className="text-xs text-muted-foreground">{h.message}</p>}
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                {clockOf(h.createdAt)}
                {h.caller ? ` · ${h.caller}` : ""}
              </p>
            </article>
          ))}
          {blitzers.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Keine Blitzer über die Hotline gemeldet.
            </p>
          )}
        </div>
        <Button
          disabled={loadingOrEmpty(blitzerBrief, blitzerScript.loading)}
          onClick={() =>
            void blitzerScript.run("Blitzer-Service (faktengetreu umformulieren)", blitzerBrief)
          }
        >
          {blitzerScript.loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          Blitzer-Sprechtext generieren
        </Button>
        {blitzerScript.error && <p className="text-sm text-destructive">{blitzerScript.error}</p>}
        {blitzerScript.script && (
          <ScriptEditor
            value={blitzerScript.script}
            onChange={blitzerScript.setScript}
            onPlay={() =>
              props.playNow(
                scriptItem("traffic", "Blitzer-Service (Text-Studio)", blitzerScript.script),
              )
            }
            onCue={() =>
              props.cueNext(
                scriptItem("traffic", "Blitzer-Service (Text-Studio)", blitzerScript.script),
              )
            }
          />
        )}
      </section>
    </div>
  );
}

/** Editierbarer generierter Sprechtext mit Senden-Buttons und Lese-Dauer. */
function ScriptEditor({
  value,
  onChange,
  onPlay,
  onCue,
}: {
  value: string;
  onChange: (v: string) => void;
  onPlay: () => void;
  onCue: () => void;
}) {
  return (
    <div className="space-y-2">
      <Textarea rows={6} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onPlay}>
          <Play className="size-4" /> Sofort senden
        </Button>
        <Button size="sm" variant="secondary" onClick={onCue}>
          Als Nächstes
        </Button>
        <span className="text-xs text-muted-foreground">
          ≈ {Math.round(speakDuration(value))} s
        </span>
      </div>
    </div>
  );
}

function loadingOrEmpty(brief: string, loading: boolean): boolean {
  return loading || brief.trim().length === 0;
}
