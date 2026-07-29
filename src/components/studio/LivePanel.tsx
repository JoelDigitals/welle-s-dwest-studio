import { useRef, useState } from "react";
import { GripVertical, Play, Radio, SkipForward, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HOSTS } from "@/lib/radio-config";
import { SLOGANS } from "@/lib/radio-data";
import { speakDuration, trafficText } from "@/lib/planner";
import type { PlanItem, TrafficFeedItem } from "@/lib/broadcast-types";
import type { MediaRecord } from "@/lib/media-db";
import type { LiveQueueItemInput } from "@/lib/use-live-studio";

type Props = {
  liveMode: boolean;
  setLiveMode: (v: boolean) => void;
  queue: PlanItem[];
  playNow: (item: LiveQueueItemInput) => void;
  cueNext: (item: LiveQueueItemInput) => void;
  remove: (uid: string) => void;
  reorder: (fromUid: string, toUid: string) => void;
  skip: () => void;
  media: MediaRecord[];
  traffic: TrafficFeedItem[];
};

const KIND_LABEL: Record<string, string> = {
  music: "Musik",
  jingle: "Jingle",
  showopener: "Opener",
  moderation: "Moderation",
  news: "Nachrichten",
  traffic: "Verkehr",
  weather: "Wetter",
  ad: "Werbung",
  slogan: "Slogan",
};

const time = (at: number) =>
  new Date(at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

/** Aus einer Bibliotheks-Datei ein Live-Warteschlangen-Element bauen – streamUrl (JDS Cloud/freie
 *  Musik) hat Vorrang vor mediaId (lokale Uploads, die es serverseitig ohnehin kaum noch gibt). */
function fromMedia(m: MediaRecord, kind: PlanItem["kind"] = "music"): LiveQueueItemInput {
  return {
    kind,
    title: m.title,
    subtitle: m.artist || m.category,
    duration: m.duration || 180,
    mediaId: m.streamUrl ? undefined : m.id,
    streamUrl: m.streamUrl,
    license: m.license,
    source: m.source,
  };
}

export function LivePanel(props: Props) {
  const [hostId, setHostId] = useState(HOSTS[0].id);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const dragUid = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const host = HOSTS.find((h) => h.id === hostId) ?? HOSTS[0];

  const music = props.media.filter(
    (m) =>
      m.kind === "music" &&
      `${m.title} ${m.artist} ${m.category}`.toLowerCase().includes(search.toLowerCase()),
  );
  const jingles = props.media.filter((m) => m.kind === "jingle");
  const sloganMedia = props.media.filter((m) => m.kind === "slogan");

  const speakItem = (value: string, title: string, kind: PlanItem["kind"] = "moderation"): LiveQueueItemInput => ({
    kind,
    title,
    subtitle: `${host.name} · KI-Stimme`,
    text: value,
    voice: host.voice,
    hostId: host.id,
    hostName: host.name,
    duration: speakDuration(value),
  });

  const trafficNow = () =>
    speakItem(
      trafficText({ media: [], news: [], traffic: props.traffic, reports: [] }, Date.now()),
      "Verkehr (manuell)",
      "traffic",
    );

  const previewMedia = async (m: MediaRecord) => {
    setPreview(m.id);
    try {
      const src = m.blob ? URL.createObjectURL(m.blob) : m.streamUrl;
      if (!src) return;
      audioRef.current?.pause();
      const audio = new Audio(src);
      audioRef.current = audio;
      await audio.play();
    } catch {
      /* Vorhören ist optional */
    } finally {
      setPreview(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Kopfzeile: Live-Schalter */}
      <section className="panel flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <h3 className="display text-xl">Livestudio</h3>
          <span
            className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest ${
              props.liveMode ? "border-signal text-signal" : "border-border text-muted-foreground"
            }`}
          >
            {props.liveMode ? "Live – manuell" : "Autopilot sendet"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => props.skip()}>
            <SkipForward className="size-4" /> Nächstes
          </Button>
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
            <Radio className="size-4 text-primary" />
            <span className="text-xs uppercase tracking-widest">Livesendung</span>
            <Switch checked={props.liveMode} onCheckedChange={props.setLiveMode} />
          </div>
        </div>
      </section>

      {!props.liveMode && (
        <p className="rounded-lg border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
          Der Autopilot sendet gerade. Schalte "Livesendung" ein, um selbst zu übernehmen – die
          Sendung ist dann erstmal leer, du ziehst Musik und Ansagen manuell rein.
        </p>
      )}
      {props.liveMode && props.queue.length === 0 && (
        <p className="rounded-lg border border-signal/40 bg-signal/10 p-3 text-sm">
          Live-Modus aktiv, aber die Warteschlange ist leer – es sendet gerade nichts. Zieh unten
          Musik rein oder sende eine Ansage.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Warteschlange mit Drag & Drop */}
        <section className="panel space-y-3 p-5 xl:col-span-2">
          <div className="flex items-center justify-between">
            <h4 className="display text-lg">
              {props.liveMode ? "Live-Warteschlange (sendet)" : "Vorschau der Autopilot-Sendung"}
            </h4>
            <span className="text-xs text-muted-foreground">
              {props.liveMode ? "Elemente ziehen zum Umsortieren" : "Nur lesbar im Autopilot"}
            </span>
          </div>
          <ul className="space-y-1.5">
            {props.queue.slice(0, 20).map((item, i) => (
              <li
                key={item.uid}
                draggable={props.liveMode && i > 0}
                onDragStart={() => (dragUid.current = item.uid)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (props.liveMode && dragUid.current) props.reorder(dragUid.current, item.uid);
                  dragUid.current = null;
                }}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                  i === 0 ? "border-signal bg-signal/10" : "border-border bg-secondary/40"
                } ${props.liveMode && i > 0 ? "cursor-grab" : ""}`}
              >
                {props.liveMode && <GripVertical className="size-4 shrink-0 text-muted-foreground" />}
                <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {time(item.plannedAt)}
                </span>
                <span className="w-24 shrink-0 text-xs uppercase tracking-widest text-primary">
                  {KIND_LABEL[item.kind] ?? item.kind}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.subtitle}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {Math.floor(item.duration / 60)}:
                  {String(Math.round(item.duration % 60)).padStart(2, "0")}
                </span>
                {props.liveMode && i > 0 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Aus der Warteschlange entfernen"
                    onClick={() => props.remove(item.uid)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
            {props.queue.length === 0 && (
              <li className="text-sm text-muted-foreground">Nichts in der Warteschlange.</li>
            )}
          </ul>
        </section>

        {/* Slogan-Launchpad */}
        <section className="panel space-y-3 p-5">
          <h4 className="display text-lg">Slogan-Launchpad</h4>
          <p className="text-xs text-muted-foreground">
            Play = vorhören im Studio. Klick auf die Kachel = live auf Sendung (nur im Live-Modus).
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {sloganMedia.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1"
              >
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`${m.title} vorhören`}
                  disabled={preview === m.id}
                  onClick={() => void previewMedia(m)}
                >
                  <Play className="size-4" />
                </Button>
                <button
                  className="min-w-0 flex-1 truncate px-1 text-left text-xs disabled:opacity-40"
                  disabled={!props.liveMode}
                  onClick={() => props.playNow(fromMedia(m, "slogan"))}
                >
                  {m.title}
                </button>
              </div>
            ))}
            {SLOGANS.slice(0, 6).map((s, i) => (
              <div key={s} className="flex items-center gap-1 rounded-lg border border-border p-1">
                <button
                  className="min-w-0 flex-1 truncate px-1 text-left text-xs disabled:opacity-40"
                  disabled={!props.liveMode}
                  onClick={() => props.playNow(speakItem(s, `Slogan ${i + 1}`, "slogan"))}
                >
                  {s}
                </button>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={!jingles.length || !props.liveMode}
            onClick={() => jingles[0] && props.playNow(fromMedia(jingles[0], "jingle"))}
          >
            <Zap className="size-4" /> Jingle jetzt
          </Button>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Moderation */}
        <section className="panel space-y-3 p-5">
          <h4 className="display text-lg">Moderation (KI-Stimme)</h4>
          <Select value={hostId} onValueChange={setHostId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOSTS.map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  {h.name} — {h.humor}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            rows={4}
            placeholder="Sprechtext für die KI-Stimme…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              disabled={!text.trim() || !props.liveMode}
              onClick={() => props.playNow(speakItem(text, `Moderation — ${host.name}`))}
            >
              Sofort senden
            </Button>
            <Button
              variant="secondary"
              disabled={!text.trim() || !props.liveMode}
              onClick={() => props.cueNext(speakItem(text, `Moderation — ${host.name}`))}
            >
              Als Nächstes
            </Button>
            <Button
              variant="ghost"
              disabled={!props.liveMode}
              onClick={() => props.playNow(trafficNow())}
            >
              Verkehr jetzt
            </Button>
          </div>
          {!props.liveMode && (
            <p className="text-xs text-muted-foreground">
              Schalte oben "Livesendung" ein, um Ansagen tatsächlich zu senden.
            </p>
          )}
        </section>

        {/* Musik */}
        <section className="panel space-y-3 p-5">
          <h4 className="display text-lg">Musik</h4>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Musik durchsuchen…"
          />
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {music.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Keine Musik in der Bibliothek – im Tab „Bibliothek" hochladen.
              </p>
            )}
            {music.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{t.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.artist} · {t.category}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!props.liveMode}
                  onClick={() => props.cueNext(fromMedia(t))}
                >
                  Cue
                </Button>
                <Button size="sm" disabled={!props.liveMode} onClick={() => props.playNow(fromMedia(t))}>
                  Play
                </Button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
