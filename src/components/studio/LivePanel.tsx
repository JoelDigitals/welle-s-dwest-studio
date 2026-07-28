import { useRef, useState } from "react";
import { CalendarPlus, GripVertical, Mic, MicOff, Play, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
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
import { manualItem, mediaItem } from "@/lib/use-radio-engine";
import type { LiveSlot, PlanItem, TrafficFeedItem } from "@/lib/broadcast-types";
import type { MediaRecord } from "@/lib/media-db";
import { speakDuration, trafficText } from "@/lib/planner";

type Props = {
  live: boolean;
  setLive: (v: boolean) => void;
  micOn: boolean;
  setMicOn: (v: boolean) => void;
  micLevel: number;
  musicVolume: number;
  setMusicVolume: (v: number) => void;
  voiceVolume: number;
  setVoiceVolume: (v: number) => void;
  playNow: (item: PlanItem) => void;
  cueNext: (item: PlanItem) => void;
  media: MediaRecord[];
  traffic: TrafficFeedItem[];
  liveSlots: LiveSlot[];
  addLiveSlot: (s: Omit<LiveSlot, "id">) => void;
  removeLiveSlot: (id: string) => void;
  plan: PlanItem[];
  reorder: (fromUid: string, toUid: string) => void;
  remove: (uid: string) => void;
  fallbackEnabled: boolean;
  setFallbackEnabled: (v: boolean) => void;
};

type RegionMix = { name: string; level: number; delay: number; fade: number; on: boolean };

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

export function LivePanel(props: Props) {
  const [hostId, setHostId] = useState(HOSTS[0].id);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [slotTitle, setSlotTitle] = useState("Livesendung");
  const [slotStart, setSlotStart] = useState("");
  const [slotMinutes, setSlotMinutes] = useState(60);
  const [slotNote, setSlotNote] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const dragUid = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const host = HOSTS.find((h) => h.id === hostId) ?? HOSTS[0];

  const [mix, setMix] = useState<RegionMix[]>([
    { name: "Saarland", level: 85, delay: 0, fade: 2, on: true },
    { name: "Rheinland-Pfalz", level: 85, delay: 0, fade: 2, on: true },
  ]);
  const [lines, setLines] = useState([
    { name: "Studio-Mikro", hint: "Hauptmoderation", on: true, level: 80 },
    { name: "Gast-Mikro", hint: "Studiogast", on: false, level: 70 },
    { name: "Telefon / Hörer", hint: "Hotline", on: false, level: 65 },
    { name: "Außenreporter", hint: "Live-Schalte", on: false, level: 70 },
    { name: "Playout", hint: "Musik & Elemente", on: true, level: 90 },
  ]);

  const music = props.media.filter(
    (m) =>
      m.kind === "music" &&
      `${m.title} ${m.artist} ${m.category}`.toLowerCase().includes(search.toLowerCase()),
  );
  const jingles = props.media.filter((m) => m.kind === "jingle");
  const sloganMedia = props.media.filter((m) => m.kind === "slogan");
  const timeline = props.plan.slice(0, 14);

  const speak = (value: string, title: string, kind: PlanItem["kind"] = "moderation") =>
    manualItem({
      kind,
      title,
      subtitle: `${host.name} · KI-Stimme`,
      text: value,
      voice: host.voice,
      duration: speakDuration(value),
    });

  const trafficNow = () =>
    speak(
      trafficText(
        { media: [], news: [], traffic: props.traffic, reports: [] },
        Date.now(),
      ),
      "Verkehr (manuell)",
      "traffic",
    );

  /** Slogan vorhören – nur im Studio, nicht auf Sendung. */
  const previewSlogan = async (id: string, value: string) => {
    setPreview(id);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: value, voice: host.voice }),
      });
      if (!res.ok) throw new Error("Vorhören nicht möglich");
      const url = URL.createObjectURL(await res.blob());
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      await audio.play();
    } catch {
      /* Vorhören ist optional */
    } finally {
      setPreview(null);
    }
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

  return (
    <div className="space-y-4">
      {/* Kopfzeile: Status & Schnellzugriffe */}
      <section className="panel flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <h3 className="display text-xl">Livestudio</h3>
          <span
            className={`rounded-full border px-3 py-1 text-xs uppercase tracking-widest ${
              props.live ? "border-signal text-signal" : "border-border text-muted-foreground"
            }`}
          >
            {props.live ? "Live" : "Autopilot"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={props.micOn ? "destructive" : "secondary"}
            onClick={() => props.setMicOn(!props.micOn)}
          >
            {props.micOn ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            {props.micOn ? "Mikro aus" : "Mikro an"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!jingles.length}
            onClick={() => jingles[0] && props.playNow(mediaItem(jingles[0], "jingle"))}
          >
            <Zap className="size-4" /> Jingle
          </Button>
          <Button size="sm" variant="secondary" onClick={() => props.playNow(trafficNow())}>
            Verkehr jetzt
          </Button>
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
            <Label htmlFor="live" className="text-xs uppercase tracking-widest">
              Livesendung
            </Label>
            <Switch id="live" checked={props.live} onCheckedChange={props.setLive} />
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
            <Label htmlFor="fb" className="text-xs uppercase tracking-widest">
              Fallback
            </Label>
            <Switch
              id="fb"
              checked={props.fallbackEnabled}
              onCheckedChange={props.setFallbackEnabled}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Zeitleiste mit Drag & Drop */}
        <section className="panel space-y-3 p-5 xl:col-span-2">
          <div className="flex items-center justify-between">
            <h4 className="display text-lg">Zeitleiste (verschiebbar)</h4>
            <span className="text-xs text-muted-foreground">Elemente ziehen zum Umplanen</span>
          </div>
          <ul className="space-y-1.5">
            {timeline.map((item, i) => (
              <li
                key={item.uid}
                draggable
                onDragStart={() => (dragUid.current = item.uid)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragUid.current) props.reorder(dragUid.current, item.uid);
                  dragUid.current = null;
                }}
                className={`flex cursor-grab items-center gap-2 rounded-lg border px-3 py-2 ${
                  i === 0 ? "border-signal bg-signal/10" : "border-border bg-secondary/40"
                }`}
              >
                <GripVertical className="size-4 shrink-0 text-muted-foreground" />
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
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Aus dem Plan entfernen"
                  onClick={() => props.remove(item.uid)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
            {timeline.length === 0 && (
              <li className="text-sm text-muted-foreground">
                Kein Element geplant – im Autopilot einen Sendeplan erzeugen.
              </li>
            )}
          </ul>
        </section>

        {/* Mixer */}
        <section className="panel space-y-4 p-5">
          <h4 className="display text-lg">Mixer</h4>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">
              Musik-Fader
            </Label>
            <Slider
              value={[props.musicVolume]}
              max={100}
              onValueChange={([v]) => props.setMusicVolume(v)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">
              Stimmen-Fader
            </Label>
            <Slider
              value={[props.voiceVolume]}
              max={100}
              onValueChange={([v]) => props.setVoiceVolume(v)}
            />
          </div>

          <div className="rounded-lg border border-border bg-secondary/40 p-3">
            <div className="flex items-center justify-between text-sm font-semibold">
              Mikrofon-Pegel
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-signal transition-[width] duration-75"
                style={{ width: `${Math.round(props.micLevel * 100)}%` }}
              />
            </div>
          </div>

          {mix.map((m, i) => (
            <div key={m.name} className="rounded-lg border border-border bg-secondary/40 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Regionalausgabe {m.name}</p>
                <Switch
                  checked={m.on}
                  onCheckedChange={(v) =>
                    setMix((p) => p.map((x, j) => (j === i ? { ...x, on: v } : x)))
                  }
                />
              </div>
              <Label className="mt-2 block text-xs text-muted-foreground">
                Lautstärke {m.level}%
              </Label>
              <Slider
                value={[m.level]}
                max={100}
                onValueChange={([v]) =>
                  setMix((p) => p.map((x, j) => (j === i ? { ...x, level: v } : x)))
                }
              />
              <Label className="mt-2 block text-xs text-muted-foreground">
                Delay {m.delay} ms
              </Label>
              <Slider
                value={[m.delay]}
                max={2000}
                step={50}
                onValueChange={([v]) =>
                  setMix((p) => p.map((x, j) => (j === i ? { ...x, delay: v } : x)))
                }
              />
              <Label className="mt-2 block text-xs text-muted-foreground">
                Übergang {m.fade} s
              </Label>
              <Slider
                value={[m.fade]}
                max={10}
                onValueChange={([v]) =>
                  setMix((p) => p.map((x, j) => (j === i ? { ...x, fade: v } : x)))
                }
              />
            </div>
          ))}

          <div className="space-y-2 border-t border-border pt-3">
            <h5 className="text-xs font-semibold uppercase tracking-widest text-primary">
              Lines & Kanäle
            </h5>
            {lines.map((line, i) => (
              <div key={line.name} className="rounded-md border border-border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">
                    {line.name}
                    <span className="block text-xs text-muted-foreground">{line.hint}</span>
                  </span>
                  <Switch
                    checked={line.on}
                    onCheckedChange={(v) =>
                      setLines((prev) => prev.map((l, j) => (j === i ? { ...l, on: v } : l)))
                    }
                  />
                </div>
                <Slider
                  className="mt-2"
                  value={[line.level]}
                  max={100}
                  onValueChange={([v]) =>
                    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, level: v } : l)))
                  }
                />
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Launchpad */}
        <section className="panel space-y-3 p-5">
          <h4 className="display text-lg">Slogan-Launchpad</h4>
          <p className="text-xs text-muted-foreground">
            Play = vorhören im Studio. Klick auf die Kachel = sofort auf Sendung.
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
                  className="min-w-0 flex-1 truncate px-1 text-left text-xs"
                  onClick={() => props.playNow(mediaItem(m, "slogan"))}
                >
                  {m.title}
                </button>
              </div>
            ))}
            {SLOGANS.map((s, i) => (
              <div
                key={s}
                className="flex items-center gap-1 rounded-lg border border-border p-1"
              >
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Slogan ${i + 1} vorhören`}
                  disabled={preview === s}
                  onClick={() => void previewSlogan(s, s)}
                >
                  <Play className="size-4" />
                </Button>
                <button
                  className="min-w-0 flex-1 px-1 text-left text-xs"
                  onClick={() => props.playNow(speak(s, "Slogan", "slogan"))}
                >
                  {s}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Moderation & Musik */}
        <section className="panel space-y-3 p-5">
          <h4 className="display text-lg">Moderation & Musik</h4>
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
              disabled={!text.trim()}
              onClick={() => props.playNow(speak(text, `Moderation — ${host.name}`))}
            >
              Sofort senden
            </Button>
            <Button
              variant="secondary"
              disabled={!text.trim()}
              onClick={() => props.cueNext(speak(text, `Moderation — ${host.name}`))}
            >
              Als Nächstes
            </Button>
          </div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Musik durchsuchen…"
          />
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {music.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Keine Musik in der Bibliothek – im Tab „Bibliothek“ hochladen.
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
                <Button size="sm" variant="ghost" onClick={() => props.cueNext(mediaItem(t))}>
                  Cue
                </Button>
                <Button size="sm" onClick={() => props.playNow(mediaItem(t))}>
                  Play
                </Button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Livesendungen planen */}
      <section className="panel space-y-3 p-5">
        <h4 className="display text-lg">Livesendung vorab planen</h4>
        <p className="text-xs text-muted-foreground">
          In geplanten Live-Fenstern plant der Autopilot nichts – es läuft nur, was hier manuell
          eingespielt wird.
        </p>
        <div className="grid gap-2 sm:grid-cols-4">
          <Input
            value={slotTitle}
            onChange={(e) => setSlotTitle(e.target.value)}
            placeholder="Titel"
          />
          <Input
            type="datetime-local"
            value={slotStart}
            onChange={(e) => setSlotStart(e.target.value)}
            aria-label="Startzeit"
          />
          <Input
            type="number"
            min={15}
            step={15}
            value={slotMinutes}
            onChange={(e) => setSlotMinutes(Math.max(15, Number(e.target.value) || 60))}
            aria-label="Dauer in Minuten"
          />
          <Input
            value={slotNote}
            onChange={(e) => setSlotNote(e.target.value)}
            placeholder="Notiz / Thema"
          />
        </div>
        <Button
          size="sm"
          disabled={!slotStart || !slotTitle.trim()}
          onClick={() => {
            props.addLiveSlot({
              title: slotTitle.trim(),
              hostId: host.id,
              hostName: host.name,
              startAt: new Date(slotStart).getTime(),
              minutes: slotMinutes,
              note: slotNote.trim(),
            });
            setSlotStart("");
            setSlotNote("");
          }}
        >
          <CalendarPlus className="size-4" /> Livesendung eintragen
        </Button>
        <ul className="space-y-1">
          {props.liveSlots
            .slice()
            .sort((a, b) => a.startAt - b.startAt)
            .map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5"
              >
                <span className="min-w-0 text-xs">
                  <span className="font-semibold">{s.title}</span> · {s.hostName} ·{" "}
                  {new Date(s.startAt).toLocaleString("de-DE", {
                    weekday: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  Uhr · {s.minutes} Min.
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => props.removeLiveSlot(s.id)}
                  aria-label="Livesendung entfernen"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
