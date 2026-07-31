import { buildPlan } from "@/lib/planner";
import type {
  NewsFeedItem,
  PlanContext,
  PlanItem,
  TrafficFeedItem,
  FreeTrack,
  LiveSlot,
} from "@/lib/broadcast-types";
import { fetchNews } from "./fetch-news";
import { fetchTraffic } from "./fetch-traffic";
import { searchFreeMusic } from "./freemusic-search";
import { curateFreeMusic, FREE_MUSIC_QUERIES } from "@/lib/free-music-pool";
import { listHotlineReports, listAnnouncedHotlineIds, markHotlineAnnounced } from "./hotline-store";
import { listApprovedAdCampaigns } from "./ad-campaigns-store";
import { synthesizeSpeechMp3Only } from "./tts-synthesize";
import {
  tryHumanizeModeration,
  tryGenerateStationId,
  tryHumanizeNews,
  tryGenerateCoHostReply,
  tryHumanizeHandoff,
  tryHumanizeCorrespondentReport,
  tryGenerateDailyTheme,
  tryHumanizeHotlineMix,
  tryHumanizeTraffic,
  tryHumanizeBlitzer,
  rankNewsByImportance,
} from "./moderation-text";
import { analyzeMp3 } from "./mp3-audio";
import { listStoredMedia, getStoredFileBuffer } from "./media-store";
import type { MediaRecord } from "@/lib/media-db";
import { listScheduledShows } from "./scheduled-shows-store";
import { getTopicForDate, listRecentTopics, recordTopic } from "./show-topics-store";
import { SHOWS } from "@/lib/radio-config";
import { berlinDateKey } from "@/lib/berlin-time";

/**
 * Autonome Sende-Engine: läuft dauerhaft im Server-Prozess, unabhängig davon, ob irgendwo ein
 * Studio- oder Player-Tab geöffnet ist. Baut den Sendeplan, erzeugt Sprache/holt Musik vorab und
 * meldet den aktuellen Stand an den bereits bestehenden /api/public/nowplaying-Store.
 */

// Klein genug, dass der Übergang zwischen zwei Sendeplan-Elementen nicht spürbar hängt (die
// eigentliche Umschaltung passiert nur zum nächsten Tick, nie sofort bei Ablauf der Dauer).
const TICK_MS = 250;
// Großzügiges Lookahead-Fenster: verhindert, dass ein hartes Zeitmarken-Vorziehen (siehe
// tickAutopilotPlanning) auf ein Element springt, dessen Audio noch gar nicht vorbereitet wurde –
// das war eine der Hauptursachen für hörbare Stille im Livestream (Sprung + leeres audioCache).
const PREPARE_AHEAD = 8;
const REFILL_HOURS = 0.25;
const REFILL_THRESHOLD_SECONDS = 8 * 60;

const NEWS_TTL_MS = 5 * 60_000;
const TRAFFIC_TTL_MS = 3 * 60_000;
const FREEMUSIC_TTL_MS = 60 * 60_000;
const MEDIA_TTL_MS = 30_000;
const SCHEDULED_SHOWS_TTL_MS = 30_000;
// Muss nicht oft geprüft werden – Tagesthemen ändern sich nur einmal pro Kalendertag, ein
// gelegentlicher Check reicht, um einen neuen Tag zeitnah zu bemerken.
const DAILY_THEMES_TTL_MS = 10 * 60_000;

/** duration ist die real gemessene Hördauer (aus den MP3-Frames) – nicht die grobe Planungsschätzung. */
type AudioEntry = { buffer: Buffer; contentType: string; duration: number };
type LiveListener = { controller: ReadableStreamDefaultController<Uint8Array> };

type EngineState = {
  plan: PlanItem[];
  /** Manuelle Warteschlange fürs Livestudio – nur relevant/aktiv, wenn liveMode true ist. Startet
   *  immer leer; der Autopilot plant hier nichts hinein, das macht ausschließlich das Studio. */
  liveQueue: PlanItem[];
  /** Solange true: der Autopilot pausiert komplett, die Sendung spielt nur, was manuell in
   *  liveQueue steht. Zurück zu false baut den Autopilot-Plan frisch neu auf. */
  liveMode: boolean;
  currentStartedAt: number | null;
  audioCache: Map<string, AudioEntry>;
  preparing: Set<string>;
  news: { items: NewsFeedItem[]; at: number };
  traffic: { items: TrafficFeedItem[]; at: number };
  freeMusic: { items: FreeTrack[]; at: number };
  media: { items: MediaRecord[]; at: number };
  /** Im Voraus geplante Sendetermine (Datum/Uhrzeit/Titel/Host) – die Engine schaltet zu ihrer
   *  Startzeit automatisch in den Livestudio-Modus und am Ende automatisch wieder zurück. */
  scheduledShows: { items: LiveSlot[]; at: number };
  /** Tagesthema je Sendung (showId -> Thema) – wiederholt sich nicht innerhalb von 90 Tagen
   *  (außer bei einer andauernden großen Nachrichtenlage), siehe ensureDailyThemes(). */
  dailyThemes: { items: Record<string, string>; at: number };
  /** An welchem Berlin-Kalendertag die aktuellen dailyThemes.items generiert wurden – ändert
   *  sich der Tag, werden alle Sendungen neu befüllt. */
  dailyThemesDate: string;
  /** ID der geplanten Sendung, die den Livestudio-Modus GERADE automatisch scharf geschaltet hat
   *  (nicht der Mensch manuell) – damit die Engine am Fensterende automatisch wieder ausschaltet. */
  autoLiveShowId: string | null;
  /** ID einer Sendung, die der Mensch bewusst vorzeitig beendet hat – verhindert, dass der
   *  nächste Tick sie sofort wieder scharf schaltet, solange ihr Zeitfenster noch läuft. */
  suppressedShowId: string | null;
  running: boolean;
  timer: ReturnType<typeof setInterval> | null;
  /** Live-Dauerstream (/live-stream): wer gerade zuhört, und wie weit im aktuellen
   *  Element schon gesendet wurde – neue Hörer:innen steigen wie bei echtem Radio live ein. */
  liveListeners: Set<LiveListener>;
  streamingUid: string | null;
  streamedBytes: number;
};

const g = globalThis as unknown as { __stationEngine?: EngineState };

function getState(): EngineState {
  g.__stationEngine ??= {
    plan: [],
    liveQueue: [],
    liveMode: false,
    currentStartedAt: null,
    audioCache: new Map(),
    preparing: new Set(),
    news: { items: [], at: 0 },
    traffic: { items: [], at: 0 },
    freeMusic: { items: [], at: 0 },
    media: { items: [], at: 0 },
    scheduledShows: { items: [], at: 0 },
    dailyThemes: { items: {}, at: 0 },
    dailyThemesDate: "",
    autoLiveShowId: null,
    suppressedShowId: null,
    running: false,
    timer: null,
    liveListeners: new Set(),
    streamingUid: null,
    streamedBytes: 0,
  };
  return g.__stationEngine;
}

/** Welche Warteschlange gerade sendet – die manuelle (Livestudio aktiv) oder die des Autopiloten. */
function activeQueue(state: EngineState): PlanItem[] {
  return state.liveMode ? state.liveQueue : state.plan;
}
function setActiveQueue(state: EngineState, next: PlanItem[]) {
  if (state.liveMode) state.liveQueue = next;
  else state.plan = next;
}

/** "/api/audio?url=..." → die ursprüngliche externe URL, damit der Server direkt (ohne
 *  Umweg über seine eigene Proxy-Route) beim Anbieter abrufen kann. */
function rawStreamUrl(streamUrl: string): string {
  try {
    const parsed = new URL(streamUrl, "http://internal.local");
    return parsed.searchParams.get("url") || streamUrl;
  } catch {
    return streamUrl;
  }
}

/** Einmal pro Kalendertag je Sendung ein neues, nicht-wiederholendes Tagesthema erzeugen (siehe
 *  show-topics-store.ts – 90-Tage-Sperrliste). Läuft bewusst NICHT als "await" in refreshFeeds/
 *  tick() mit, da hier bis zu 6 sequenzielle KI-Aufrufe nötig sein können – das würde Wiedergabe
 *  und Livestream für mehrere Sekunden einfrieren lassen. Läuft stattdessen im Hintergrund über
 *  mehrere Ticks hinweg; bis ein Thema fertig ist, nutzt buildContext() einfach den Fallback. */
async function ensureDailyThemes(state: EngineState) {
  const now = Date.now();
  if (now - state.dailyThemes.at < DAILY_THEMES_TTL_MS) return;
  state.dailyThemes.at = now;
  const today = berlinDateKey(now);
  const items: Record<string, string> =
    state.dailyThemesDate === today ? { ...state.dailyThemes.items } : {};
  if (Object.keys(items).length >= SHOWS.length) {
    state.dailyThemesDate = today;
    return;
  }
  const topNews = state.news.items.slice(0, 5).map((n) => n.headline);
  for (const show of SHOWS) {
    if (items[show.id]) continue;
    try {
      const existing = await getTopicForDate(show.id, today);
      if (existing) {
        items[show.id] = existing;
        continue;
      }
      const recent = await listRecentTopics(show.id, 90);
      const theme = await tryGenerateDailyTheme({
        direction: show.topics.join(", "),
        recentTopics: recent.map((r) => r.topic),
        topNews,
        fallback: show.topics[0] ?? show.title,
      });
      await recordTopic(show.id, theme, today);
      items[show.id] = theme;
    } catch (err) {
      console.error("[station-engine] Tagesthema fehlgeschlagen:", show.id, err);
      items[show.id] = show.topics[0] ?? show.title;
    }
  }
  state.dailyThemes = { items, at: now };
  state.dailyThemesDate = today;
}

async function refreshFeeds(state: EngineState) {
  const now = Date.now();
  const jobs: Array<Promise<void>> = [];

  if (now - state.news.at > NEWS_TTL_MS) {
    jobs.push(
      fetchNews(6)
        .then(async (r) => {
          // KI sortiert je Region nach Wichtigkeit statt nach zufälliger Feed-Reihenfolge –
          // newsStories() nimmt weiterhin nur die ersten N pro Region, die sind jetzt aber
          // priorisiert. Bei Fehlern/Timeout bleibt die ursprüngliche Reihenfolge erhalten.
          const ranked = await rankNewsByImportance(r.items);
          state.news = { items: ranked, at: now };
        })
        .catch(() => undefined),
    );
  }
  if (now - state.traffic.at > TRAFFIC_TTL_MS) {
    jobs.push(
      fetchTraffic()
        .then((r) => {
          state.traffic = { items: r.items, at: now };
        })
        .catch(() => undefined),
    );
  }
  if (now - state.media.at > MEDIA_TTL_MS) {
    jobs.push(
      listStoredMedia()
        .then((items) => {
          state.media = { items: items as MediaRecord[], at: now };
        })
        .catch(() => undefined),
    );
  }
  if (now - state.scheduledShows.at > SCHEDULED_SHOWS_TTL_MS) {
    jobs.push(
      listScheduledShows()
        .then((items) => {
          state.scheduledShows = { items, at: now };
        })
        .catch(() => undefined),
    );
  }
  if (now - state.freeMusic.at > FREEMUSIC_TTL_MS || state.freeMusic.items.length === 0) {
    jobs.push(
      Promise.all(
        FREE_MUSIC_QUERIES.map((q) => searchFreeMusic(q, 10).catch(() => [] as FreeTrack[])),
      )
        .then((lists) => {
          const curated = curateFreeMusic(lists.flat());
          if (curated.length) state.freeMusic = { items: curated, at: now };
        })
        .catch(() => undefined),
    );
  }
  await Promise.all(jobs);
  // Bewusst nicht awaited (siehe Kommentar an ensureDailyThemes) – darf den Tick nicht blockieren.
  void ensureDailyThemes(state).catch((err) =>
    console.error("[station-engine] Tagesthemen fehlgeschlagen:", err),
  );
}

function buildContext(state: EngineState): PlanContext {
  return {
    media: state.media.items,
    news: state.news.items,
    traffic: state.traffic.items,
    reports: [],
    hotline: listHotlineReports(),
    freeMusic: state.freeMusic.items,
    adCampaigns: listApprovedAdCampaigns(),
    liveSlots: state.scheduledShows.items,
    dailyThemes: state.dailyThemes.items,
    hotlineAnnouncedIds: listAnnouncedHotlineIds(),
    markHotlineAnnounced,
    approvalRequired: false,
  };
}

/** fetch mit Timeout – ein einzelner hängender Musik-Stream darf die Engine nie blockieren. */
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Schneidet ID3-Tags (oft mit eingebettetem Cover-Bild) heraus und liefert die echte Hördauer –
 *  ohne das würden ID3-Bytes in der Zeit-zu-Byte-Umrechnung des Livestreams als Audio mitzählen
 *  und den Anfang eines Titels abschneiden bzw. verzögern. */
function trimToAudio(raw: Buffer, fallbackDuration: number): { buffer: Buffer; duration: number } {
  const { audioStart, audioEnd, durationSeconds } = analyzeMp3(raw);
  const buffer =
    audioStart > 0 || audioEnd < raw.length
      ? raw.subarray(audioStart, audioEnd || raw.length)
      : raw;
  return { buffer, duration: durationSeconds > 0.5 ? durationSeconds : fallbackDuration };
}

async function prepareAudio(item: PlanItem): Promise<AudioEntry | null> {
  // Mikrofon-Live-Element: es gibt keine Datei und keinen Text zum Vorbereiten – die echten Bytes
  // kommen erst live über pushMicAudioChunk() rein, sobald der Bediener wirklich spricht.
  if (item.kind === "mic") return null;
  // Eigene Bibliothek (Musik/Jingles/Slogans/Werbespots, vom Studio hochgeladen) – geht davon aus,
  // dass die Datei ein MP3 ist, genau wie der Rest des Systems (KI-Sprachausgabe, freie Musik).
  if (item.mediaId && !item.streamUrl) {
    const raw = await getStoredFileBuffer(item.mediaId);
    if (!raw) return null; // Datei nicht (mehr) auf dem Server vorhanden
    const { buffer, duration } = trimToAudio(raw, item.duration);
    return { buffer, contentType: "audio/mpeg", duration };
  }
  if (item.streamUrl) {
    const res = await fetchWithTimeout(rawStreamUrl(item.streamUrl), 15_000);
    if (!res.ok) throw new Error(`Musik-Stream nicht erreichbar (${res.status})`);
    const raw = Buffer.from(await res.arrayBuffer());
    // Für den durchgehenden Live-Stream (/live-stream) muss der Content-Type immer
    // audio/mpeg sein – die Musiksuche liefert ohnehin ausschließlich MP3-Dateien.
    const { buffer, duration } = trimToAudio(raw, item.duration);
    return { buffer, contentType: "audio/mpeg", duration };
  }
  const text = item.text?.trim();
  if (!text) return null;
  // Moderation und Senderkennungen werden frei (um)formuliert (dürfen neue Formulierungen/Ideen
  // einbringen). Nachrichten werden nur sprachlich geglättet (nie Fakten ändern) – vorher klangen
  // Schlagzeilen roh vorgelesen wie eine Aufzählung statt wie ein echter Nachrichtensprecher.
  // Der Verkehrsblock (mit offiziellen Meldungen UND Hörer-Hinweisen aus der Hotline) wird mit
  // dem faktentreuen Verkehrsfunk-Prompt geglättet: Straßen, Orte und Angaben bleiben exakt,
  // nur die Formulierung klingt wie ein echter Verkehrsfunk-Moderator statt wie eine rohe Liste.
  // Wetter/Werbung bleiben unverändert (Wetter und Werbung sind schon eigene generierte Texte).
  // Co-Moderator:innen-Einwurf in einer 2er-Show: statt der generischen Umformulierung reagiert
  // die zweite Stimme hier per KI echt auf das Thema, über das der Hauptmoderator gerade
  // gesprochen hat (dialogueTopic), damit ein echtes Gespräch statt zweier Solo-Ansagen entsteht.
  const spokenText =
    item.kind === "moderation" && item.dialogueTopic
      ? await tryGenerateCoHostReply(item.dialogueTopic, text, item.hostName)
      : item.kind === "moderation" && item.handoff
        ? await tryHumanizeHandoff(text)
        : item.kind === "moderation" && item.correspondentReport
          ? await tryHumanizeCorrespondentReport(text)
          : item.kind === "moderation" && item.hotlineMix
            ? await tryHumanizeHotlineMix(text, item.hostName)
            : item.kind === "moderation"
              ? await tryHumanizeModeration(text, item.hostName)
              : item.kind === "slogan"
                ? await tryGenerateStationId(text)
                : item.kind === "news"
                  ? await tryHumanizeNews(text)
                  : item.kind === "traffic" && item.blitzerService
                    ? await tryHumanizeBlitzer(text, item.hostName)
                    : item.kind === "traffic"
                      ? await tryHumanizeTraffic(text)
                      : text;
  // Immer Edge-TTS (nie Gemini): garantiert MP3 und kein Tageskontingent, das den 24/7-Betrieb
  // oder den Live-Stream unterbrechen könnte. hostId sorgt bei Personas, die sich eine der nur
  // 10 verfügbaren deutschen Stimmen mit einer Moderation teilen müssen, für eine kleine, feste
  // Tonhöhen-Verschiebung, damit sie trotzdem wie eine eigene Stimme klingen (siehe PERSONA_PITCH).
  const raw = await synthesizeSpeechMp3Only(
    spokenText,
    item.voice ?? "alloy",
    item.kind,
    item.hostId,
  );
  const { buffer, duration } = trimToAudio(raw, item.duration);
  return { buffer, contentType: "audio/mpeg", duration };
}

function ensureAudioPreparing(state: EngineState) {
  const upcoming = activeQueue(state).slice(0, PREPARE_AHEAD);
  for (const item of upcoming) {
    if (item.kind === "mic") continue; // kein Audio zum Vorbereiten – kommt live rein
    if (state.audioCache.has(item.uid) || state.preparing.has(item.uid)) continue;
    state.preparing.add(item.uid);
    prepareAudio(item)
      .then((entry) => {
        if (entry) {
          state.audioCache.set(item.uid, entry);
          // Die geplante Dauer war nur eine Schätzung (Textlänge bzw. Musik-Metadaten) – jetzt auf
          // die tatsächlich gemessene Länge korrigieren, sonst wartet der Sendeplan nach Ende der
          // Audiodatei noch auf die (zu lange) Schätzung = stille Pause, oder schneidet bei einer
          // zu kurzen Schätzung noch laufendes Audio ab.
          if (entry.duration > 0) item.duration = entry.duration;
        }
      })
      .catch((err) => {
        console.error("[station-engine] Audio fehlgeschlagen:", item.title, err);
      })
      .finally(() => {
        state.preparing.delete(item.uid);
      });
  }
}

/** Grobe Schätzung, wie lange das Intro eines Musiktitels instrumental sein dürfte, bevor der
 *  Gesang einsetzt – eine echte Erkennung bräuchte Audioanalyse (Dekodierung + Energieverlauf),
 *  die hier bewusst nicht gebaut wird. Dient nur als Richtwert für die Ansage-Überblendung: die
 *  Moderation darf ungefähr so lange "über" den Titel drüber sprechen. */
function introSecondsFor(item: PlanItem): number {
  if (item.kind !== "music") return 0;
  return Math.min(10, Math.max(4, Math.round(item.duration * 0.12)));
}

function publishNowPlaying(state: EngineState) {
  const queue = activeQueue(state);
  const current = queue[0] ?? null;
  const elapsed =
    current && state.currentStartedAt ? (Date.now() - state.currentStartedAt) / 1000 : 0;
  const g2 = globalThis as unknown as { __nowPlaying?: Record<string, unknown> };
  // Die Stream-URL wird separat vom Studio unter "Ausgabe" per POST gesetzt (nur dieses eine
  // Feld) – hier unverändert übernehmen, statt sie bei jedem Tick zu überschreiben.
  const streamUrl = (g2.__nowPlaying?.streamUrl as string | null | undefined) ?? null;
  g2.__nowPlaying = {
    station: "Welle Südwest",
    show: current?.showId ? current.subtitle : null,
    host: current?.hostName ?? null,
    kind: current?.kind ?? null,
    title: current?.title ?? null,
    subtitle: current?.subtitle ?? null,
    uid: current?.uid ?? null,
    startedAt: current && state.currentStartedAt ? state.currentStartedAt : null,
    duration: current?.duration ?? 0,
    introSeconds: current ? introSecondsFor(current) : 0,
    elapsed,
    onAir: Boolean(current && state.currentStartedAt),
    // Livestudio aktiv? Dann sendet nur die manuelle Warteschlange, der Autopilot pausiert.
    live: state.liveMode,
    // Bleibt leer, solange im Studio unter "Ausgabe" kein echter Icecast-Stream hinterlegt ist –
    // der Webplayer steigt dann stattdessen live in genau dieses Sendeplan-Element ein.
    streamUrl,
    // Großzügig viele Folge-Elemente – das Studio zeigt daraus die echte Timeline (statt einer
    // eigenen lokalen Simulation), damit Studio, Webplayer & Co. immer exakt dasselbe zeigen.
    next: queue.slice(1, 60).map((i) => ({
      uid: i.uid,
      kind: i.kind,
      title: i.title,
      subtitle: i.subtitle,
      duration: i.duration,
      introSeconds: introSecondsFor(i),
      plannedAt: i.plannedAt,
    })),
    updatedAt: Date.now(),
  };
}

/**
 * Lückenfüller (freie Musik), wenn der Sendeplan eine harte Zeitmarke (Nachrichten zur vollen/
 * halben Stunde) zu früh erreicht – vorher gab es dafür nur ein Vorziehen bei Verspätung, aber
 * kein Zurückhalten bei Verfrühung. Wenn z. B. mehrere Elemente in Folge kürzer laufen als
 * geplant (die tatsächlich gemessene Audiolänge weicht von der Schätzung ab), lief die Sendung
 * der echten Uhrzeit immer weiter davon – bis die 13-Uhr-Nachrichten schon um 12:30 Uhr kamen.
 * Wählt den Titel, dessen Dauer der Lücke am nächsten kommt (weder unnötig kurz zurückbleiben
 * noch stark überschießen).
 */
function insertFiller(state: EngineState, gapMs: number): boolean {
  const gapSeconds = gapMs / 1000;
  const library = state.media.items
    .filter((m) => m.kind === "music" && m.streamUrl)
    .map((m) => ({
      title: m.title,
      artist: m.artist,
      category: m.category,
      duration: m.duration || 180,
      streamUrl: m.streamUrl,
      license: m.license,
      source: m.source,
    }));
  const candidates = [...library, ...state.freeMusic.items];
  if (!candidates.length) return false;
  const fitting = candidates.filter((t) => t.duration <= gapSeconds + 30);
  const pool = fitting.length ? fitting : candidates;
  const track = pool.reduce((best, t) =>
    Math.abs(t.duration - gapSeconds) < Math.abs(best.duration - gapSeconds) ? t : best,
  );
  const filler: PlanItem = {
    uid: `filler-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "music",
    title: track.title,
    subtitle: `${track.artist || "Unbekannt"} · ${track.category}${track.license ? ` · ${track.license}` : ""}`,
    duration: track.duration || 180,
    plannedAt: Date.now(),
    status: "idle",
    streamUrl: track.streamUrl,
    license: track.license,
    source: track.source,
    sponsor: null,
  };
  state.plan = [filler, ...state.plan];
  return true;
}

/** Prüft, ob gerade eine im Voraus geplante Livesendung läuft, und schaltet die Engine
 *  entsprechend automatisch in den Livestudio-Modus bzw. wieder zurück in den Autopiloten –
 *  ohne dass jemand manuell den Schalter betätigen muss. Ein bewusst vorzeitig beendeter
 *  Termin wird nicht sofort wieder scharf geschaltet (suppressedShowId), solange sein
 *  Zeitfenster noch läuft. */
function tickScheduledShows(state: EngineState) {
  const now = Date.now();
  const active = state.scheduledShows.items.find(
    (s) => now >= s.startAt && now < s.startAt + s.minutes * 60_000,
  );
  if (active) {
    if (state.suppressedShowId === active.id) return;
    if (!state.liveMode) {
      setLiveMode(true);
      state.autoLiveShowId = active.id;
    } else if (!state.autoLiveShowId) {
      state.autoLiveShowId = active.id;
    }
  } else {
    if (state.autoLiveShowId) {
      setLiveMode(false);
      state.autoLiveShowId = null;
    }
    state.suppressedShowId = null;
  }
}

/** Autopilot-spezifisch: harte Zeitmarken vorziehen und den Sendeplan auffüllen. Läuft nie im
 *  Livestudio-Modus – dort gibt es weder Zeitmarken noch automatische Planung. */
function tickAutopilotPlanning(state: EngineState) {
  const now = Date.now();
  const hardIdx = state.plan.findIndex(
    (i) => i.hardStart && i.hardStart <= now && i.hardStart > now - 90_000,
  );
  // Nur springen, wenn das Zielelement (z. B. die Nachrichten) schon fertig vorbereitet ist –
  // sonst würde der Sprung selbst eine hörbare Stille erzeugen (Timer läuft schon, Audio fehlt
  // noch). Ein paar Sekunden Zeitplan-Drift sind unhörbar, eine Stille im Livestream nicht.
  if (hardIdx > 0 && state.audioCache.has(state.plan[hardIdx].uid)) {
    state.plan = state.plan.slice(hardIdx);
    state.currentStartedAt = null;
  }

  const totalPlanned = state.plan.reduce((sum, i) => sum + i.duration, 0);
  if (state.plan.length === 0) {
    state.plan = buildPlan({ from: new Date(), hours: REFILL_HOURS, ctx: buildContext(state) });
  } else if (totalPlanned < REFILL_THRESHOLD_SECONDS) {
    const last = state.plan[state.plan.length - 1];
    const from = new Date(last.plannedAt + last.duration * 1000);
    const more = buildPlan({ from, hours: REFILL_HOURS, ctx: buildContext(state) });
    state.plan = [...state.plan, ...more];
  }
}

/** Generischer Fortschritt durch die jeweils aktive Warteschlange (Autopilot-Plan oder
 *  Live-Warteschlange) – sobald ein Element zu Ende ist, direkt im selben Tick das nächste
 *  starten, wenn dessen Audio schon vorbereitet ist. Harte Zeitmarken/Lückenfüller gibt es nur
 *  im Autopilot, nicht im Livestudio-Modus (dort entscheidet ausschließlich der Mensch). */
function advanceQueue(state: EngineState) {
  for (;;) {
    const queue = activeQueue(state);
    const current = queue[0];
    if (!current) break;
    if (state.currentStartedAt === null) {
      if (!state.liveMode) {
        const gap = current.hardStart ? current.hardStart - Date.now() : 0;
        if (gap > 60_000) {
          if (insertFiller(state, gap)) continue;
        }
      }
      // "mic" hat kein Audio zum Cachen (die Bytes kommen erst live rein, sobald gesprochen wird) –
      // muss trotzdem sofort starten, sonst würde die Wiedergabe für immer hier hängen bleiben.
      if (state.audioCache.has(current.uid) || current.kind === "mic") {
        state.currentStartedAt = Date.now();
      }
      break;
    }
    const elapsed = (Date.now() - state.currentStartedAt) / 1000;
    if (elapsed < current.duration) break;
    state.audioCache.delete(current.uid);
    setActiveQueue(state, queue.slice(1));
    state.currentStartedAt = null;
    state.streamingUid = null;
    state.streamedBytes = 0;
  }
}

async function tick() {
  const state = getState();
  if (state.running) return;
  state.running = true;
  try {
    await refreshFeeds(state);

    tickScheduledShows(state);

    if (!state.liveMode) {
      tickAutopilotPlanning(state);
    }

    ensureAudioPreparing(state);
    advanceQueue(state);
    streamLiveAudio(state);
    publishNowPlaying(state);
  } catch (err) {
    console.error("[station-engine] Tick-Fehler:", err);
  } finally {
    state.running = false;
  }
}

/**
 * Speist den durchgehenden Live-Stream (/live-stream): schickt genau so viele Bytes des
 * aktuellen Elements an alle verbundenen Hörer:innen, wie inzwischen "vergangen" ist – dieselbe
 * Uhr (currentStartedAt), die auch nowPlaying.elapsed antreibt. So bleibt der Stream in Echtzeit,
 * statt eine ganze Datei auf einmal loszuschicken.
 */
function streamLiveAudio(state: EngineState) {
  if (state.liveListeners.size === 0) return;
  const current = activeQueue(state)[0];
  if (!current || state.currentStartedAt === null) return;
  // Mikrofon-Element: nichts aus dem audioCache streamen – die echten Bytes kommen live über
  // pushMicAudioChunk() (Mikrofon-Ingest-Route) direkt an state.liveListeners.
  if (current.kind === "mic") return;
  const entry = state.audioCache.get(current.uid);
  if (!entry) return;

  if (state.streamingUid !== current.uid) {
    state.streamingUid = current.uid;
    state.streamedBytes = 0;
  }
  const elapsed = Math.min(current.duration, (Date.now() - state.currentStartedAt) / 1000);
  const targetBytes = Math.floor((elapsed / current.duration) * entry.buffer.length);
  if (targetBytes <= state.streamedBytes) return;

  const chunk = entry.buffer.subarray(state.streamedBytes, targetBytes);
  state.streamedBytes = targetBytes;
  for (const listener of state.liveListeners) {
    try {
      listener.controller.enqueue(new Uint8Array(chunk));
    } catch {
      state.liveListeners.delete(listener);
    }
  }
}

/** Neue Hörer:in für /live-stream – steigt wie bei echtem Radio genau jetzt mit ein.
 *  Bekommt sofort den bereits "gesendeten" Teil des laufenden Elements als einmaligen Schub
 *  vorab (statt nur die künftige Echtzeit-Trickle abzuwarten) – sonst dauert es bei einer reinen
 *  Echtzeit-Rate mehrere Sekunden Stille, bis der Player genug Puffer zum Start hat. */
export function subscribeLive(): ReadableStream<Uint8Array> {
  const state = getState();
  let listener: LiveListener;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      listener = { controller };
      state.liveListeners.add(listener);
      const current = activeQueue(state)[0];
      const entry = current ? state.audioCache.get(current.uid) : undefined;
      if (entry && state.streamedBytes > 0) {
        controller.enqueue(new Uint8Array(entry.buffer.subarray(0, state.streamedBytes)));
      }
    },
    cancel() {
      state.liveListeners.delete(listener);
    },
  });
}

/** Nimmt einen MP3-Byte-Chunk vom Mikrofon-Ingest (/api/mic-stream) entgegen und reicht ihn direkt
 *  an alle /live-stream-Hörer:innen durch – nur wirksam, während wirklich ein "mic"-Element läuft
 *  (Sicherheitscheck gegen Bytes zur falschen Zeit, z. B. nach dem Beenden der Aufnahme). */
export function pushMicAudioChunk(buffer: Buffer) {
  const state = getState();
  const current = activeQueue(state)[0];
  if (!current || current.kind !== "mic") return;
  for (const listener of state.liveListeners) {
    try {
      listener.controller.enqueue(new Uint8Array(buffer));
    } catch {
      state.liveListeners.delete(listener);
    }
  }
}

export function startStationEngine() {
  const state = getState();
  if (state.timer) return;
  console.log("[station-engine] Autonome Sende-Engine gestartet.");
  state.timer = setInterval(() => void tick(), TICK_MS);
  void tick();
}

export function getCurrentAudio(): (AudioEntry & { uid: string }) | null {
  const state = getState();
  const current = activeQueue(state)[0];
  if (!current || state.currentStartedAt === null) return null;
  const entry = state.audioCache.get(current.uid);
  return entry ? { ...entry, uid: current.uid } : null;
}

/** Audio eines bereits vorbereiteten kommenden Elements (nicht nur des aktuellen) – für die
 *  clientseitige Überblendung: kurz bevor das aktuelle Element endet, wird das nächste schon
 *  vorab geladen, damit es nahtlos/überlappend gestartet werden kann statt hart zu schneiden. */
export function getAudioByUid(uid: string): (AudioEntry & { uid: string }) | null {
  const state = getState();
  const entry = state.audioCache.get(uid);
  return entry ? { ...entry, uid } : null;
}

/** Studio-Steuerung: das aktuelle Element der echten Sendung sofort beenden und weiterschalten
 *  (Autopilot) bzw. das aktuelle Live-Element beenden (Livestudio). */
export function forceSkipCurrent(): boolean {
  const state = getState();
  const queue = activeQueue(state);
  const current = queue[0];
  if (!current) return false;
  state.audioCache.delete(current.uid);
  setActiveQueue(state, queue.slice(1));
  state.currentStartedAt = null;
  state.streamingUid = null;
  state.streamedBytes = 0;
  return true;
}

/** Ob gerade der Livestudio-Modus aktiv ist (Autopilot pausiert, es sendet nur, was manuell in
 *  die Warteschlange gegeben wird). */
export function getLiveMode(): boolean {
  return getState().liveMode;
}

/** Livestudio-Modus umschalten. Beim Einschalten: leere Warteschlange, es sendet erstmal nichts,
 *  bis der Host etwas hineinzieht. Beim Ausschalten: der alte Autopilot-Plan ist inzwischen
 *  zeitlich überholt (plannedAt/hardStart liegen in der Vergangenheit) – wird verworfen, der
 *  Autopilot baut beim nächsten Tick einen frischen Plan auf. */
export function setLiveMode(on: boolean) {
  const state = getState();
  if (state.liveMode === on) return;
  state.liveMode = on;
  state.currentStartedAt = null;
  state.streamingUid = null;
  state.streamedBytes = 0;
  state.audioCache.clear();
  state.preparing.clear();
  if (!on) {
    state.plan = [];
  }
}

/** Wie setLiveMode, aber für den manuellen Schalter im Studio: wird eine automatisch gestartete
 *  geplante Sendung von Hand vorzeitig beendet, merkt sich die Engine das (suppressedShowId),
 *  damit der nächste Tick sie nicht sofort wieder scharf schaltet, solange ihr Zeitfenster
 *  noch läuft. */
export function setLiveModeManual(on: boolean) {
  const state = getState();
  if (!on && state.autoLiveShowId) {
    state.suppressedShowId = state.autoLiveShowId;
    state.autoLiveShowId = null;
  }
  setLiveMode(on);
}

export type LiveQueueInput = {
  kind: PlanItem["kind"];
  title: string;
  subtitle: string;
  duration: number;
  text?: string;
  voice?: string;
  hostId?: string;
  hostName?: string;
  mediaId?: string;
  streamUrl?: string;
  license?: string;
  source?: string;
  sponsor?: string | null;
};

/** Element in die Live-Warteschlange einfügen. playNow=true beendet das aktuell laufende Element
 *  sofort und setzt das neue an dessen Stelle (wie ein DJ, der manuell den Titel wechselt); sonst
 *  wird hinten angehängt ("als Nächstes"). */
export function addToLiveQueue(input: LiveQueueInput, playNow: boolean): PlanItem {
  const state = getState();
  const item: PlanItem = {
    uid: `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind,
    title: input.title,
    subtitle: input.subtitle,
    duration: input.duration,
    plannedAt: Date.now(),
    status: "idle",
    text: input.text,
    voice: input.voice,
    hostId: input.hostId,
    hostName: input.hostName,
    mediaId: input.mediaId,
    streamUrl: input.streamUrl,
    license: input.license,
    source: input.source,
    sponsor: input.sponsor ?? null,
  };
  if (playNow) {
    const current = state.liveQueue[0];
    if (current) state.audioCache.delete(current.uid);
    state.liveQueue = [item, ...state.liveQueue.slice(current ? 1 : 0)];
    state.currentStartedAt = null;
    state.streamingUid = null;
    state.streamedBytes = 0;
  } else {
    state.liveQueue = [...state.liveQueue, item];
  }
  return item;
}

/** Element aus der Live-Warteschlange entfernen. Läuft es gerade, wird es wie ein Skip behandelt
 *  (sauber beenden), statt es der laufenden Wiedergabe mitten unterm Kopfhörer wegzuziehen. */
export function removeFromLiveQueue(uid: string) {
  const state = getState();
  if (state.liveQueue[0]?.uid === uid) {
    forceSkipCurrent();
    return;
  }
  state.liveQueue = state.liveQueue.filter((i) => i.uid !== uid);
}

/** Live-Warteschlange umsortieren (Drag & Drop im Studio). Das gerade laufende Element (Index 0)
 *  bleibt fest – während es on air ist, würde ein Verschieben den Startzeitpunkt durcheinanderbringen. */
export function reorderLiveQueue(fromUid: string, toUid: string) {
  const state = getState();
  const list = [...state.liveQueue];
  const fromIdx = list.findIndex((i) => i.uid === fromUid);
  const toIdx = list.findIndex((i) => i.uid === toUid);
  if (fromIdx <= 0 || toIdx <= 0 || fromIdx === toIdx) return;
  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
  state.liveQueue = list;
}

export function getLiveQueue(): PlanItem[] {
  return getState().liveQueue;
}
