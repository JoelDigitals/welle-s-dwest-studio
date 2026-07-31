import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  GripVertical,
  Mic,
  Mic2,
  Newspaper,
  Play,
  Radio,
  SkipForward,
  Trash2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HOSTS } from "@/lib/radio-config";
import { SLOGANS } from "@/lib/radio-data";
import { speakDuration, trafficText } from "@/lib/planner";
import { useScheduledShows } from "@/lib/use-scheduled-shows";
import { useMyRecordings } from "@/lib/use-my-recordings";
import { useAuth } from "@/lib/use-auth";
import { useMicBroadcast } from "@/lib/use-mic-broadcast";
import type { PlanItem, TrafficFeedItem, NewsFeedItem, HotlineReport } from "@/lib/broadcast-types";
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
  news: NewsFeedItem[];
  hotline: HotlineReport[];
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
  recording: "Aufnahme",
  mic: "Mikrofon",
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
  // Feste Stimme für die Notfall-KI-Ansage – bewusst keine Auswahl aus den KI-Moderator:innen im
  // Livesendung-Tab, echte Livesendungen werden von echten Personen (Accounts) gehostet.
  const host = HOSTS[0];
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const dragUid = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { user: me } = useAuth();
  const { recordings } = useMyRecordings();
  const schedule = useScheduledShows();
  const [showTitle, setShowTitle] = useState("");
  const [showAt, setShowAt] = useState("");
  const [showMinutes, setShowMinutes] = useState("60");

  const [micTitle, setMicTitle] = useState("");
  const [micSubtitle, setMicSubtitle] = useState("");
  const [micMinutes, setMicMinutes] = useState("3");
  const mic = useMicBroadcast();
  // Mikrofon-Steuerung (Berechtigung/An-Aus/Pegel/Lautstärke) ist bewusst IMMER nutzbar, nicht
  // erst wenn das Mikrofon-Element schon on air ist – so kann die Berechtigung eingeholt und der
  // Pegel geprüft werden, bevor das Studio überhaupt live geht. micLive markiert nur, ob gerade
  // wirklich gesendet wird (fürs "ON AIR"-Badge und die Ausgangs-Anzeige).
  const micLive = props.liveMode && props.queue[0]?.kind === "mic";
  const wasMicLiveRef = useRef(false);

  // Wenn das Mikrofon-Element on air ENDET (Ablauf der Dauer, Skip, oder Umschalten weg von
  // Live), ohne dass der Bediener selbst "Mikrofon aus" gedrückt hat: Aufnahme trotzdem sauber
  // beenden, sonst würde weiter unbemerkt Mikrofon-Ton kodiert und ins Leere gesendet. Löst aber
  // NICHT aus, nur weil micLive noch nie true war (sonst könnte man den Test-Betrieb vor dem
  // Livegang nie starten).
  useEffect(() => {
    if (wasMicLiveRef.current && !micLive && mic.active) mic.stop();
    wasMicLiveRef.current = micLive;
  }, [micLive, mic.active, mic.stop]);

  const micItem = (): LiveQueueItemInput => ({
    kind: "mic",
    title: micTitle.trim() || "Live-Mikrofon",
    subtitle: micSubtitle.trim() || `${me?.displayName ?? "Live"} · Mikrofon`,
    duration: Math.max(30, (Number(micMinutes) || 3) * 60),
  });

  const stopMic = () => {
    mic.stop();
    if (micLive) props.skip();
  };

  const music = props.media.filter(
    (m) =>
      m.kind === "music" &&
      `${m.title} ${m.artist} ${m.category}`.toLowerCase().includes(search.toLowerCase()),
  );
  const jingles = props.media.filter((m) => m.kind === "jingle");
  const sloganMedia = props.media.filter((m) => m.kind === "slogan");

  const speakItem = (
    value: string,
    title: string,
    kind: PlanItem["kind"] = "moderation",
  ): LiveQueueItemInput => ({
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
      trafficText(
        { media: [], news: [], traffic: props.traffic, reports: [], hotline: props.hotline },
        Date.now(),
      ),
      "Verkehr (manuell)",
      "traffic",
    );

  const newsNow = () => {
    const top = props.news.slice(0, 3);
    const brief = top.map((n) => `${n.headline}. ${n.body}`).join(" ");
    return {
      kind: "news" as const,
      title: "Nachrichten (manuell)",
      subtitle: "Aktuelle Meldungen",
      text: brief || "Aktuell liegen keine neuen Meldungen vor.",
      voice: host.voice,
      duration: speakDuration(brief || " "),
    };
  };

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

  const createShow = async () => {
    if (!showTitle.trim() || !showAt || !me) return;
    const startAt = new Date(showAt).getTime();
    if (!Number.isFinite(startAt)) return;
    const ok = await schedule.create({
      title: showTitle.trim(),
      hostId: me.userId,
      hostName: me.displayName,
      startAt,
      minutes: Number(showMinutes) || 60,
    });
    if (ok) {
      setShowTitle("");
      setShowAt("");
    }
  };

  return (
    <div className="space-y-4">
      {/* On-Air-Leiste: der Hauptregler des Studios */}
      <section className="panel flex flex-wrap items-center justify-between gap-3 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`onair-badge inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold tracking-widest ${
              props.liveMode
                ? "bg-onair text-destructive-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <Radio className="size-4" /> {props.liveMode ? "ON AIR" : "AUTOPILOT"}
          </span>
          <div>
            <h3 className="display text-xl leading-none">Livestudio</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {props.liveMode
                ? (props.queue[0]?.title ?? "Warteschlange leer")
                : props.queue.length
                  ? `${props.queue.length} Elemente vorbereitet – noch nicht on air`
                  : "Autopilot sendet – noch nichts vorbereitet"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => props.skip()}>
            <SkipForward className="size-4" /> Nächstes
          </Button>
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
            <span className="text-xs uppercase tracking-widest">Livesendung</span>
            <Switch checked={props.liveMode} onCheckedChange={props.setLiveMode} />
          </div>
        </div>
      </section>

      {!props.liveMode && (
        <p className="rounded-lg border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
          Der Autopilot sendet gerade – du kannst deine Livesendung trotzdem schon jetzt komplett
          vorbereiten (Reihenfolge unten bauen, Musik/Aufnahmen reinziehen). Schalte "Livesendung"
          ein, sobald es losgehen soll, oder plane einen Sendetermin – dann übernimmt die Engine
          automatisch.
        </p>
      )}
      {props.liveMode && props.queue.length === 0 && (
        <p className="rounded-lg border border-signal/40 bg-signal/10 p-3 text-sm">
          Live-Modus aktiv, aber die Warteschlange ist leer – es sendet gerade nichts. Zieh unten
          Musik, eine Aufnahme oder ein Jingle rein.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        {/* Running Order */}
        <section className="panel space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h4 className="display text-lg">
              Live-Warteschlange {props.liveMode ? "(sendet)" : "(vorbereitet)"}
            </h4>
            <span className="text-xs text-muted-foreground">Elemente ziehen zum Umsortieren</span>
          </div>
          <ul className="space-y-1.5">
            {props.queue.slice(0, 20).map((item, i) => (
              <li
                key={item.uid}
                draggable={i > 0}
                onDragStart={() => (dragUid.current = item.uid)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragUid.current) props.reorder(dragUid.current, item.uid);
                  dragUid.current = null;
                }}
                className={`flex items-center gap-2 rounded-lg border px-3 ${
                  i === 0 ? "border-signal bg-signal/10 py-3" : "border-border bg-secondary/40 py-2"
                } ${i > 0 ? "cursor-grab" : ""}`}
              >
                {i > 0 && <GripVertical className="size-4 shrink-0 text-muted-foreground" />}
                <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {time(item.plannedAt)}
                </span>
                <span className="w-24 shrink-0 text-xs uppercase tracking-widest text-primary">
                  {KIND_LABEL[item.kind] ?? item.kind}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate font-semibold ${i === 0 ? "text-base" : "text-sm"}`}
                  >
                    {item.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.subtitle}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {Math.floor(item.duration / 60)}:
                  {String(Math.round(item.duration % 60)).padStart(2, "0")}
                </span>
                {i > 0 && (
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

        {/* Cart-Wall */}
        <section className="panel space-y-3 p-5">
          <h4 className="display text-lg">Cart-Wall</h4>
          <Tabs defaultValue="jingles">
            <TabsList className="w-full">
              <TabsTrigger value="jingles" className="flex-1">
                Jingles & Slogans
              </TabsTrigger>
              <TabsTrigger value="recordings" className="flex-1">
                Aufnahmen
              </TabsTrigger>
              <TabsTrigger value="music" className="flex-1">
                Musik
              </TabsTrigger>
            </TabsList>

            <TabsContent value="jingles" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Play = vorhören im Studio. Klick auf die Kachel = sofort in die Live-Warteschlange
                (läuft erst, sobald "Livesendung" an ist).
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {jingles.map((m) => (
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
                      onClick={() => props.playNow(fromMedia(m, "jingle"))}
                    >
                      {m.title}
                    </button>
                  </div>
                ))}
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
                      onClick={() => props.playNow(fromMedia(m, "slogan"))}
                    >
                      {m.title}
                    </button>
                  </div>
                ))}
                {SLOGANS.slice(0, 6).map((s, i) => (
                  <div
                    key={s}
                    className="flex items-center gap-1 rounded-lg border border-border p-1"
                  >
                    <button
                      className="min-w-0 flex-1 truncate px-1 text-left text-xs disabled:opacity-40"
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
                disabled={!jingles.length}
                onClick={() => jingles[0] && props.playNow(fromMedia(jingles[0], "jingle"))}
              >
                <Zap className="size-4" /> Jingle jetzt
              </Button>
            </TabsContent>

            <TabsContent value="recordings" className="space-y-1.5">
              {recordings.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Keine Aufnahmen in der Bibliothek – im Tab „Bibliothek" als „Aufnahme" hochladen.
                </p>
              )}
              <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {recordings.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2"
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
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{m.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.artist || m.category}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => props.cueNext(fromMedia(m, "recording"))}
                    >
                      Cue
                    </Button>
                    <Button size="sm" onClick={() => props.playNow(fromMedia(m, "recording"))}>
                      Play
                    </Button>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="music" className="space-y-3">
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
                    <Button size="sm" variant="ghost" onClick={() => props.cueNext(fromMedia(t))}>
                      Cue
                    </Button>
                    <Button size="sm" onClick={() => props.playNow(fromMedia(t))}>
                      Play
                    </Button>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </section>
      </div>

      {/* Mikrofon – echtes Live-Sprechen statt KI-Stimme */}
      <section className="panel space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="display flex items-center gap-2 text-lg">
            <Mic className="size-4" /> Mikrofon
          </h4>
          {/* Ausgang: zeigt jederzeit, was diesen Moment wirklich gesendet wird – unabhängig
              davon, ob das Mikrofon gerade nur zum Testen an ist. */}
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-xs">
            <span className="uppercase tracking-widest text-muted-foreground">Ausgang:</span>
            <span className="font-semibold">
              {props.liveMode
                ? (props.queue[0]?.title ?? "Warteschlange leer")
                : "Autopilot sendet"}
            </span>
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Titel, Untertitel und Dauer sind frei wählbar – erscheinen so im Studio, Player & Co. Das
          Mikrofon selbst kann schon vorab getestet werden (Berechtigung erteilen, Pegel/Lautstärke
          prüfen), bevor das Element wirklich on air ist – gesendet wird erst, sobald "Ausgang" oben
          wirklich dieses Mikrofon-Element zeigt.
        </p>
        <div className="grid gap-2 sm:grid-cols-[1.2fr_1fr_0.6fr]">
          <Input
            value={micTitle}
            onChange={(e) => setMicTitle(e.target.value)}
            placeholder="Titel (z. B. Interview, Gespräch)"
          />
          <Input
            value={micSubtitle}
            onChange={(e) => setMicSubtitle(e.target.value)}
            placeholder="Untertitel (optional)"
          />
          <Input
            type="number"
            min={1}
            value={micMinutes}
            onChange={(e) => setMicMinutes(e.target.value)}
            placeholder="Min."
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => props.playNow(micItem())}>
            Jetzt sprechen
          </Button>
          <Button size="sm" variant="secondary" onClick={() => props.cueNext(micItem())}>
            Als Nächstes
          </Button>
        </div>

        {/* Mikrofon-Steuerung: immer bedienbar (nicht erst wenn on air), damit Berechtigung,
            Pegel und Lautstärke schon vor dem Livegang geprüft werden können. */}
        <div
          className={`space-y-2 rounded-lg border p-3 ${
            micLive && mic.active ? "border-onair bg-onair/10" : "border-border bg-secondary/40"
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant={mic.active ? "destructive" : "default"}
              onClick={() => (mic.active ? stopMic() : void mic.start())}
            >
              <Mic2 className="size-4" /> {mic.active ? "Mikrofon aus" : "Mikrofon an"}
            </Button>
            {mic.active && (
              <Button
                size="sm"
                variant={mic.muted ? "secondary" : "outline"}
                onClick={() => mic.setMuted(!mic.muted)}
              >
                {mic.muted ? "Stumm (aufheben)" : "Stummschalten"}
              </Button>
            )}
            {mic.active && (
              <Button
                size="sm"
                variant={mic.monitor ? "secondary" : "outline"}
                onClick={() => mic.setMonitor(!mic.monitor)}
                title="Nur mit Kopfhörern benutzen – über Lautsprecher gibt es sonst eine Rückkopplung (Pfeifen)."
              >
                {mic.monitor ? "Mithören (an)" : "Über Kopfhörer mithören"}
              </Button>
            )}
            {mic.active && (
              <span
                className={`text-xs font-bold ${
                  mic.muted
                    ? "text-muted-foreground"
                    : micLive
                      ? "text-onair"
                      : "text-muted-foreground"
                }`}
              >
                {mic.muted ? "● STUMM" : micLive ? "● ON AIR" : "● Test (nicht on air)"}
              </span>
            )}
            <div className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-signal transition-[width] duration-100"
                style={{ width: `${Math.min(100, Math.round(mic.level * 140))}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-xs text-muted-foreground">Eingangslautstärke</span>
            <Slider
              min={0}
              max={2}
              step={0.05}
              value={[mic.gain]}
              onValueChange={([v]) => mic.setGain(v)}
              className="flex-1"
            />
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {Math.round(mic.gain * 100)}%
            </span>
          </div>
          {mic.active && (
            <p className="text-xs text-muted-foreground">
              Gesendet: {(mic.sentBytes / 1024).toFixed(1)} KB
              {mic.sentBytes === 0 &&
                " – noch keine Bytes raus, kurz warten oder ins Mikrofon sprechen"}
            </p>
          )}
          {mic.error && <p className="text-xs text-destructive">{mic.error}</p>}
        </div>

        <div className="rounded-lg border border-border bg-secondary/40 p-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Nachrichtentext zum Selbstvorlesen
          </p>
          {props.news.slice(0, 3).map((n) => (
            <p key={n.id} className="mb-2 text-sm last:mb-0">
              <span className="font-semibold">{n.headline}.</span> {n.body}
            </p>
          ))}
          {props.news.length === 0 && (
            <p className="text-sm text-muted-foreground">Aktuell keine Meldungen.</p>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Nachrichten jetzt – die einzige weiterhin KI-vertonte Ansage im Live-Workflow */}
        <section className="panel space-y-3 p-5">
          <h4 className="display flex items-center gap-2 text-lg">
            <Newspaper className="size-4" /> Nachrichten jetzt
          </h4>
          <p className="text-xs text-muted-foreground">
            Liest die {Math.min(3, props.news.length)} aktuellsten Meldungen mit KI-Stimme vor –
            einzige KI-Ansage, die für echte Livesendungen vorgesehen ist.
          </p>
          <div className="flex gap-2">
            <Button disabled={!props.news.length} onClick={() => props.playNow(newsNow())}>
              Sofort senden
            </Button>
            <Button
              variant="secondary"
              disabled={!props.news.length}
              onClick={() => props.cueNext(newsNow())}
            >
              Als Nächstes
            </Button>
          </div>
        </section>

        {/* Notfall-KI-Moderation – bewusst eingeklappt und aus dem Hauptfluss genommen */}
        <Collapsible>
          <section className="panel space-y-3 p-5">
            <CollapsibleTrigger asChild>
              <button className="flex w-full items-center justify-between text-left">
                <h4 className="display text-lg text-muted-foreground">Nur für Notfälle</h4>
                <ChevronDown className="size-4 text-muted-foreground" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Für echte Livesendungen bitte keine KI-Texte verwenden – nur Musik, Jingles,
                Aufnahmen und Nachrichten. Diese freie KI-Ansage ist nur für Notfälle gedacht (z. B.
                eine technische Störungsmeldung, wenn niemand live spricht).
              </p>
              <Textarea
                rows={3}
                placeholder="Sprechtext für die KI-Stimme…"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!text.trim()}
                  onClick={() => props.playNow(speakItem(text, `Moderation — ${host.name}`))}
                >
                  Sofort senden
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!text.trim()}
                  onClick={() => props.cueNext(speakItem(text, `Moderation — ${host.name}`))}
                >
                  Als Nächstes
                </Button>
                <Button size="sm" variant="ghost" onClick={() => props.playNow(trafficNow())}>
                  Verkehr jetzt
                </Button>
              </div>
            </CollapsibleContent>
          </section>
        </Collapsible>
      </div>

      {/* Sendeplan */}
      <section className="panel space-y-3 p-5">
        <h4 className="display text-lg">Sendeplan</h4>
        <p className="text-xs text-muted-foreground">
          Geplante Sendetermine schalten automatisch in den Livestudio-Modus und am Ende wieder
          zurück in den Autopiloten. Bau den Rundown vorher schon über Cart-Wall/Musik oben auf.
          Gastgeber:in bist du selbst – {me?.displayName ?? "…"}.
        </p>
        <div className="grid gap-2 sm:grid-cols-[1.3fr_1fr_0.7fr_auto]">
          <Input
            value={showTitle}
            onChange={(e) => setShowTitle(e.target.value)}
            placeholder="Titel der Sendung"
          />
          <Input type="datetime-local" value={showAt} onChange={(e) => setShowAt(e.target.value)} />
          <Input
            type="number"
            min={5}
            value={showMinutes}
            onChange={(e) => setShowMinutes(e.target.value)}
            placeholder="Min."
          />
          <Button onClick={() => void createShow()} disabled={!showTitle.trim() || !showAt || !me}>
            Anlegen
          </Button>
        </div>
        {schedule.error && <p className="text-sm text-destructive">{schedule.error}</p>}
        <ul className="space-y-1.5">
          {schedule.shows.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2"
            >
              <span className="w-36 shrink-0 text-xs tabular-nums text-muted-foreground">
                {new Date(s.startAt).toLocaleString("de-DE", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{s.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {s.hostName} · {s.minutes} Min.
                </span>
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Sendetermin löschen"
                onClick={() => void schedule.remove(s.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
          {schedule.shows.length === 0 && (
            <li className="text-sm text-muted-foreground">Keine Sendetermine geplant.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
