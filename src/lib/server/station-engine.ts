import { buildPlan } from "@/lib/planner";
import type {
  NewsFeedItem,
  PlanContext,
  PlanItem,
  TrafficFeedItem,
  FreeTrack,
} from "@/lib/broadcast-types";
import { fetchNews } from "./fetch-news";
import { fetchTraffic } from "./fetch-traffic";
import { searchFreeMusic } from "./freemusic-search";
import { curateFreeMusic, FREE_MUSIC_QUERIES } from "@/lib/free-music-pool";
import { listHotlineReports } from "./hotline-store";
import { listApprovedAdCampaigns } from "./ad-campaigns-store";
import { synthesizeSpeechMp3Only } from "./tts-synthesize";
import {
  tryHumanizeModeration,
  tryGenerateStationId,
  tryHumanizeNews,
  rankNewsByImportance,
} from "./moderation-text";
import { analyzeMp3 } from "./mp3-audio";
import { listStoredMedia, getStoredFileBuffer } from "./media-store";
import type { MediaRecord } from "@/lib/media-db";

/**
 * Autonome Sende-Engine: läuft dauerhaft im Server-Prozess, unabhängig davon, ob irgendwo ein
 * Studio- oder Player-Tab geöffnet ist. Baut den Sendeplan, erzeugt Sprache/holt Musik vorab und
 * meldet den aktuellen Stand an den bereits bestehenden /api/public/nowplaying-Store.
 */

// Klein genug, dass der Übergang zwischen zwei Sendeplan-Elementen nicht spürbar hängt (die
// eigentliche Umschaltung passiert nur zum nächsten Tick, nie sofort bei Ablauf der Dauer).
const TICK_MS = 250;
const PREPARE_AHEAD = 3;
const REFILL_HOURS = 0.25;
const REFILL_THRESHOLD_SECONDS = 8 * 60;

const NEWS_TTL_MS = 5 * 60_000;
const TRAFFIC_TTL_MS = 3 * 60_000;
const FREEMUSIC_TTL_MS = 60 * 60_000;
const MEDIA_TTL_MS = 30_000;

/** duration ist die real gemessene Hördauer (aus den MP3-Frames) – nicht die grobe Planungsschätzung. */
type AudioEntry = { buffer: Buffer; contentType: string; duration: number };
type LiveListener = { controller: ReadableStreamDefaultController<Uint8Array> };

type EngineState = {
  plan: PlanItem[];
  currentStartedAt: number | null;
  audioCache: Map<string, AudioEntry>;
  preparing: Set<string>;
  news: { items: NewsFeedItem[]; at: number };
  traffic: { items: TrafficFeedItem[]; at: number };
  freeMusic: { items: FreeTrack[]; at: number };
  media: { items: MediaRecord[]; at: number };
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
    currentStartedAt: null,
    audioCache: new Map(),
    preparing: new Set(),
    news: { items: [], at: 0 },
    traffic: { items: [], at: 0 },
    freeMusic: { items: [], at: 0 },
    media: { items: [], at: 0 },
    running: false,
    timer: null,
    liveListeners: new Set(),
    streamingUid: null,
    streamedBytes: 0,
  };
  return g.__stationEngine;
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
    liveSlots: [],
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
    audioStart > 0 || audioEnd < raw.length ? raw.subarray(audioStart, audioEnd || raw.length) : raw;
  return { buffer, duration: durationSeconds > 0.5 ? durationSeconds : fallbackDuration };
}

async function prepareAudio(item: PlanItem): Promise<AudioEntry | null> {
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
  // Verkehr/Wetter/Werbung bleiben unverändert (Wetter/Werbung sind schon eigene generierte
  // Texte, Verkehr enthält sicherheitsrelevante Angaben, die exakt bleiben sollen).
  const spokenText =
    item.kind === "moderation"
      ? await tryHumanizeModeration(text, item.hostName)
      : item.kind === "slogan"
        ? await tryGenerateStationId(text)
        : item.kind === "news"
          ? await tryHumanizeNews(text)
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
  const upcoming = state.plan.slice(0, PREPARE_AHEAD);
  for (const item of upcoming) {
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
  const current = state.plan[0] ?? null;
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
    // Bleibt leer, solange im Studio unter "Ausgabe" kein echter Icecast-Stream hinterlegt ist –
    // der Webplayer steigt dann stattdessen live in genau dieses Sendeplan-Element ein.
    streamUrl,
    // Großzügig viele Folge-Elemente – das Studio zeigt daraus die echte Timeline (statt einer
    // eigenen lokalen Simulation), damit Studio, Webplayer & Co. immer exakt dasselbe zeigen.
    next: state.plan.slice(1, 60).map((i) => ({
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

async function tick() {
  const state = getState();
  if (state.running) return;
  state.running = true;
  try {
    await refreshFeeds(state);

    // Harte Zeitmarken (Nachrichten zur vollen/halben Stunde) sekundengenau vorziehen.
    const now = Date.now();
    const hardIdx = state.plan.findIndex(
      (i) => i.hardStart && i.hardStart <= now && i.hardStart > now - 90_000,
    );
    if (hardIdx > 0) {
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

    ensureAudioPreparing(state);

    // In einer Schleife statt nur einmal prüfen: sobald ein Element zu Ende ist, direkt im selben
    // Tick das nächste starten, wenn dessen Audio schon vorbereitet ist (Regelfall dank
    // PREPARE_AHEAD) – sonst entsteht zwischen jedem Element eine bis zu einsekündige Lücke.
    for (;;) {
      const current = state.plan[0];
      if (!current) break;
      if (state.currentStartedAt === null) {
        // Harte Zeitmarke noch nicht erreicht (z. B. Nachrichten erst zur vollen Stunde) – nicht
        // einfach jetzt schon starten, sondern erst noch Musik als Lückenfüller einschieben, bis
        // die Zeit wirklich da ist (siehe insertFiller-Kommentar).
        const gap = current.hardStart ? current.hardStart - Date.now() : 0;
        if (gap > 60_000) {
          if (insertFiller(state, gap)) continue;
        }
        if (state.audioCache.has(current.uid)) {
          state.currentStartedAt = Date.now();
        }
        break;
      }
      const elapsed = (Date.now() - state.currentStartedAt) / 1000;
      if (elapsed < current.duration) break;
      state.audioCache.delete(current.uid);
      state.plan = state.plan.slice(1);
      state.currentStartedAt = null;
      state.streamingUid = null;
      state.streamedBytes = 0;
    }

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
  const current = state.plan[0];
  if (!current || state.currentStartedAt === null) return;
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
      const current = state.plan[0];
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

export function startStationEngine() {
  const state = getState();
  if (state.timer) return;
  console.log("[station-engine] Autonome Sende-Engine gestartet.");
  state.timer = setInterval(() => void tick(), TICK_MS);
  void tick();
}

export function getCurrentAudio(): (AudioEntry & { uid: string }) | null {
  const state = getState();
  const current = state.plan[0];
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

/** Studio-Steuerung: das aktuelle Element der echten Sendung sofort beenden und weiterschalten. */
export function forceSkipCurrent(): boolean {
  const state = getState();
  const current = state.plan[0];
  if (!current) return false;
  state.audioCache.delete(current.uid);
  state.plan = state.plan.slice(1);
  state.currentStartedAt = null;
  state.streamingUid = null;
  state.streamedBytes = 0;
  return true;
}
