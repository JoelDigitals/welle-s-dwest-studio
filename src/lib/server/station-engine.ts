import { buildPlan, urgentTrafficItems } from "@/lib/planner";
import {
  MORNING_SLOT,
  OVERLAY_DUCKING_DB,
  OVERLAY_WORDS_MAX,
  wordCount,
  TRAFFIC_POLL_MINUTES,
  regionalActionDays,
  screenAiText,
  stripNewsTitleMarkers,
} from "@/lib/station-rules";
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
import { fetchRpr1Reports, fetchSalueReports } from "./fetch-station-traffic";
import {
  listStationReports,
  syncStationReports,
  type StoredStationReport,
} from "./station-reports-store";
import { fetchWarnings } from "./fetch-warnings";
import { fetchWeather } from "./fetch-weather";
import type { CivilWarning, WeatherData } from "@/lib/broadcast-types";
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
  tryHumanizeCivilWarning,
  tryHumanizeNewsReaction,
  rankNewsByImportance,
} from "./moderation-text";
import { analyzeMp3 } from "./mp3-audio";
import {
  playDeck,
  pushMicChunk,
  startMicDeck,
  startMixer,
  stopAllDecks,
  stopDeck,
  subscribeStream,
} from "./live-mixer";
import { effectiveOverlap, overlapForbidden } from "@/lib/auto-regie";
import { listStoredMedia, getStoredFileBuffer } from "./media-store";
import type { MediaRecord } from "@/lib/media-db";
import { listScheduledShows } from "./scheduled-shows-store";
import {
  getTopicForDate,
  listRecentTopics,
  recordTopic,
  setTopicForDate,
} from "./show-topics-store";
import { SHOWS } from "@/lib/radio-config";
import { berlinDateKey } from "@/lib/berlin-time";
import { CURIOSITY_DAYS } from "@/lib/curiosity-days";
import { ensureArticlesPersisted, upgradeThinArticles } from "./news-articles-store";

/**
 * Autonome Sende-Engine: läuft dauerhaft im Server-Prozess, unabhängig davon, ob irgendwo ein
 * Studio- oder Player-Tab geöffnet ist. Baut den Sendeplan, erzeugt Sprache/holt Musik vorab und
 * meldet den aktuellen Stand an den bereits bestehenden /api/public/nowplaying-Store.
 */

// Klein genug, dass der Übergang zwischen zwei Sendeplan-Elementen nicht spürbar hängt (die
// eigentliche Umschaltung passiert nur zum nächsten Tick, nie sofort bei Ablauf der Dauer).
const TICK_MS = 250;
const TICK_STUCK_MS = 120_000;
/** Höchstdauer für das Vorbereiten eines Elements (Download bzw. KI-Text + Sprachausgabe). */
const PREPARE_TIMEOUT_MS = 120_000;
const MAX_PREPARE_FAILURES = 3;
// Großzügiges Lookahead-Fenster: verhindert, dass ein hartes Zeitmarken-Vorziehen (siehe
// tickAutopilotPlanning) auf ein Element springt, dessen Audio noch gar nicht vorbereitet wurde –
// das war eine der Hauptursachen für hörbare Stille im Livestream (Sprung + leeres audioCache).
const PREPARE_AHEAD = 8;
const REFILL_HOURS = 0.25;
const REFILL_THRESHOLD_SECONDS = 8 * 60;

const NEWS_TTL_MS = 5 * 60_000;
// Muss zum gesprochenen Fallback "Wir prüfen in X Minuten erneut" passen (station-rules.ts).
const TRAFFIC_TTL_MS = TRAFFIC_POLL_MINUTES * 60_000;
/** Abgleich mit Radio Salü/RPR1 (Regel 3: alle 5 Minuten). */
const STATION_REPORTS_TTL_MS = 5 * 60_000;
// Amtliche Warnungen (Bevölkerungsschutz/Wetter/Polizei/Hochwasser) dürfen nicht lange veraltet
// sein – kürzeres Intervall als Nachrichten/Verkehr, da eine neue Warnung so schnell wie möglich
// on air soll.
const WARNINGS_TTL_MS = 2 * 60_000;
// Echtes Wetter ändert sich langsam – kein Grund, öfter als alle 20 Minuten neu abzufragen.
const WEATHER_TTL_MS = 20 * 60_000;
const FREEMUSIC_TTL_MS = 60 * 60_000;
const MEDIA_TTL_MS = 30_000;
const SCHEDULED_SHOWS_TTL_MS = 30_000;
// Muss nicht oft geprüft werden – Tagesthemen ändern sich nur einmal pro Kalendertag, ein
// gelegentlicher Check reicht, um einen neuen Tag zeitnah zu bemerken.
const DAILY_THEMES_TTL_MS = 10 * 60_000;

/** duration ist die real gemessene Hördauer (aus den MP3-Frames) – nicht die grobe Planungsschätzung. */
type AudioEntry = {
  buffer: Buffer;
  contentType: string;
  duration: number;
  /** Mehrspur: Musikbett, das der Sendemischer unter diesem Element mitlaufen lässt. */
  bed?: Buffer;
};

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
  /** Fehlversuche beim Audio-Vorbereiten je Element – nach MAX_PREPARE_FAILURES wird es
   *  übersprungen, statt dass die Engine für immer auf ein nie fertig werdendes Audio wartet. */
  prepareFailures: Map<string, number>;
  /** Regel 14: Elemente, die die KI als editor_needed markiert hat – werden NICHT per TTS
   *  ausgespielt, sondern landen hier für die Redaktion (siehe /api/production). */
  editorHolds: EditorHold[];
  /** Bereits als Sofort-Verkehrsmeldung angesagte Feed-/Hotline-IDs (Regel 3: "sofort"). */
  urgentAnnounced: Set<string>;
  urgentCheckedAt: number;
  /** Mehrspur: uid des Elements, das gerade mit seinem Vorgänger gemischt wird. */
  mixingUid: string | null;
  news: { items: NewsFeedItem[]; at: number };
  traffic: { items: TrafficFeedItem[]; at: number };
  /** Blitzer + Verkehr von Radio Salü/RPR1, abgeglichen mit der Datenbank. */
  stationReports: { items: StoredStationReport[]; at: number };
  /** Amtliche Warnungen (BBK: MoWaS/DWD/Katwarn/Polizei/Hochwasser/Biwapp) für Saarland/RLP. */
  warnings: { items: CivilWarning[]; at: number };
  /** "<id>:<version>"-Schlüssel bereits vorgelesener Warnungen – verhindert Wiederholung. */
  warningsAnnounced: Set<string>;
  /** Echtes aktuelles Wetter + 3-Tage-Ausblick (Open-Meteo) – null nur, wenn die API gerade
   *  nicht erreichbar war (dann fällt weatherText() in planner.ts auf die alte Schätzung zurück). */
  weather: { data: WeatherData | null; at: number };
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
  /** Startzeit des laufenden Ticks – Wächter gegen einen für immer hängenden Tick (siehe tick()). */
  runningSince: number;
  timer: ReturnType<typeof setInterval> | null;
};

export type EditorHold = {
  uid: string;
  kind: string;
  title: string;
  plannedAt: number;
  reason: string;
  text: string;
  heldAt: number;
};

/** Ausnahme für prepareAudio: Element darf laut Regel 14 nicht automatisch per TTS raus. */
class EditorHoldError extends Error {
  constructor(
    readonly reason: string,
    readonly text: string,
  ) {
    super(reason);
  }
}

const g = globalThis as unknown as { __stationEngine?: EngineState };

function getState(): EngineState {
  g.__stationEngine ??= {
    plan: [],
    liveQueue: [],
    liveMode: false,
    currentStartedAt: null,
    audioCache: new Map(),
    preparing: new Set(),
    prepareFailures: new Map(),
    editorHolds: [],
    urgentAnnounced: new Set(),
    urgentCheckedAt: 0,
    mixingUid: null,
    news: { items: [], at: 0 },
    traffic: { items: [], at: 0 },
    stationReports: { items: [], at: 0 },
    warnings: { items: [], at: 0 },
    warningsAnnounced: new Set(),
    weather: { data: null, at: 0 },
    freeMusic: { items: [], at: 0 },
    media: { items: [], at: 0 },
    scheduledShows: { items: [], at: 0 },
    dailyThemes: { items: {}, at: 0 },
    dailyThemesDate: "",
    autoLiveShowId: null,
    suppressedShowId: null,
    running: false,
    runningSince: 0,
    timer: null,
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
  // Echte, verifizierte Kuriositäts-/Aktionstage des heutigen Kalendertags (z. B. "Tag des
  // Fleischkäses") – Datenquelle kuriose-feiertage.de (siehe curiosity-days.ts). "today" ist
  // "YYYY-MM-DD", die letzten 5 Zeichen ergeben den "MM-DD"-Schlüssel der Tabelle.
  const curiosityDays = regionalActionDays(CURIOSITY_DAYS[today.slice(5)] ?? []);
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
        // Regel 10: Aktionstage-Vorschläge gehören in den Morning-Slot (06–10 Uhr) – nur
        // Sendungen, deren 4-Stunden-Fenster ihn berührt, bekommen sie als Themenvorschlag.
        curiosityDays:
          show.startHour < MORNING_SLOT.toHour && show.startHour + 4 > MORNING_SLOT.fromHour
            ? curiosityDays
            : [],
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
          // Läuft bewusst NICHT awaited im Hintergrund weiter (KI-Artikel je neuer Meldung
          // schreiben + speichern kann mehrere Sekunden dauern) - der Sende-Tick soll darauf
          // nicht warten müssen.
          void ensureArticlesPersisted(ranked).catch(() => undefined);
          // Charge älterer, damals fehlgeschlagener ("roh gebliebener") Artikel erneut versuchen -
          // unabhängig davon, ob die Meldung noch im Live-Feed steht, sonst würden längst
          // rotierte Meldungen nie wieder einen echten Artikel bekommen.
          void upgradeThinArticles().catch(() => undefined);
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
  if (now - state.stationReports.at > STATION_REPORTS_TTL_MS) {
    state.stationReports.at = now;
    jobs.push(
      (async () => {
        // Abgleich: neue Meldungen einfügen, verschwundene löschen. Schlägt ein Abruf fehl
        // (null), bleibt der letzte Stand dieser Quelle unangetastet.
        const [salue, rpr1] = await Promise.all([fetchSalueReports(), fetchRpr1Reports()]);
        if (salue) await syncStationReports("salue", salue);
        if (rpr1) await syncStationReports("rpr1", rpr1);
        state.stationReports = { items: await listStationReports(), at: now };
      })().catch((err) =>
        console.error("[station-engine] Salü/RPR1-Abgleich fehlgeschlagen:", err),
      ),
    );
  }
  if (now - state.warnings.at > WARNINGS_TTL_MS) {
    jobs.push(
      fetchWarnings()
        .then((r) => {
          state.warnings = { items: r.items, at: now };
        })
        .catch(() => undefined),
    );
  }
  if (now - state.weather.at > WEATHER_TTL_MS) {
    jobs.push(
      fetchWeather()
        .then((data) => {
          // Nur bei einem echten Treffer überschreiben – schlägt der Abruf fehl (data === null),
          // bleibt das zuletzt bekannte echte Wetter stehen, statt sofort auf die Schätzung
          // zurückzufallen (kurzer API-Ausfall soll nicht sofort hörbar sein).
          if (data) state.weather = { data, at: now };
          else state.weather = { ...state.weather, at: now };
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

const TRAFFIC_STOPWORDS = new Set([
  "richtung",
  "zwischen",
  "verkehr",
  "stockender",
  "dichter",
  "minuten",
  "minute",
  "zeitverlust",
  "kilometer",
]);
function trafficWords(text: string) {
  return new Set(
    (text.toLowerCase().match(/[a-zäöüß-]{5,}/g) ?? []).filter((w) => !TRAFFIC_STOPWORDS.has(w)),
  );
}

/** Offizielle Meldungen + Salü/RPR1 zusammenführen – dieselbe Lage (gleiche Straße, mindestens
 *  zwei gemeinsame Ortswörter) nur einmal, die offizielle Autobahn-Meldung hat Vorrang. */
function mergedTraffic(state: EngineState): TrafficFeedItem[] {
  const out = [...state.traffic.items];
  for (const r of state.stationReports.items) {
    if (r.type !== "verkehr") continue;
    const words = trafficWords(r.title);
    const road = r.road.replace(/\s+/g, "").toUpperCase();
    const duplicate = out.some((t) => {
      if (road && t.road.replace(/\s+/g, "").toUpperCase() !== road) return false;
      const shared = [...trafficWords(`${t.headline} ${t.message}`)].filter((w) => words.has(w));
      return shared.length >= 2;
    });
    if (duplicate) continue;
    out.push({
      id: r.id,
      road: r.road,
      region: r.region,
      headline: r.title,
      message: "",
      since: new Date(r.reportedAt).toISOString(),
      source: r.source,
    });
  }
  return out;
}

async function buildContext(state: EngineState): Promise<PlanContext> {
  return {
    media: state.media.items,
    news: state.news.items,
    traffic: mergedTraffic(state),
    stationBlitzer: state.stationReports.items
      .filter((r) => r.type === "blitzer")
      .map((r) => ({
        id: r.id,
        source: r.source,
        region: r.region,
        road: r.road,
        title: r.title,
        reportedAt: r.reportedAt,
      })),
    reports: [],
    hotline: await listHotlineReports(),
    freeMusic: state.freeMusic.items,
    adCampaigns: listApprovedAdCampaigns(),
    liveSlots: state.scheduledShows.items,
    dailyThemes: state.dailyThemes.items,
    hotlineAnnouncedIds: listAnnouncedHotlineIds(),
    markHotlineAnnounced,
    civilWarnings: state.warnings.items,
    civilWarningsAnnouncedIds: [...state.warningsAnnounced],
    markCivilWarningsAnnounced: (keys) => keys.forEach((k) => state.warningsAnnounced.add(k)),
    weather: state.weather.data,
    approvalRequired: false,
  };
}

/** Lädt eine Datei mit Timeout – ein einzelner hängender Musik-Stream darf die Engine nie
 *  blockieren. Der Timeout gilt bis der komplette Inhalt da ist, nicht nur bis zu den Headern:
 *  vorher konnte ein stockender Download das Element für immer im Zustand "wird vorbereitet"
 *  festhalten – und damit den ganzen Sendeplan. */
async function fetchBufferWithTimeout(url: string, ms: number): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Musik-Stream nicht erreichbar (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what}: Zeitüberschreitung nach ${ms / 1000}s`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
    const raw = await fetchBufferWithTimeout(rawStreamUrl(item.streamUrl), 60_000);
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
  const spokenText = item.civilWarning
    ? await tryHumanizeCivilWarning(text)
    : item.kind === "moderation" && item.dialogueTopic
      ? await tryGenerateCoHostReply(item.dialogueTopic, text, item.hostName)
      : item.kind === "moderation" && item.handoff
        ? await tryHumanizeHandoff(text)
        : item.kind === "moderation" && item.correspondentReport
          ? await tryHumanizeCorrespondentReport(text)
          : item.kind === "moderation" && item.hotlineMix
            ? await tryHumanizeHotlineMix(text, item.hostName)
            : item.kind === "moderation" && item.newsGrounded
              ? await tryHumanizeNewsReaction(text, item.hostName)
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
  // Regel 11/14: interne KI-Marker nie sprechen. Markiert die KI einen Text als prüfpflichtig
  // (eigene Stellungnahme zu Recht/Gesundheit/Politik, unklare Meldung) oder fehlt eine Quelle,
  // spielt der Autopilot ihn NICHT per TTS aus – er geht an die Redaktion. Ausnahme: amtliche
  // Warnmeldungen der Behörden, die sind bereits behördlich geprüft und dürfen nie zurückgehalten
  // werden.
  const screened = screenAiText(spokenText);
  if ((screened.editorNeeded || screened.sourceMissing) && !item.civilWarning) {
    throw new EditorHoldError(
      screened.sourceMissing ? "Quelle fehlt" : "Redaktionelle Prüfung nötig",
      screened.text,
    );
  }
  const finalText = item.kind === "news" ? stripNewsTitleMarkers(screened.text) : screened.text;
  item.meta = {
    auto_generated: true,
    sources: item.meta?.sources ?? [],
    ts: item.meta?.ts ?? new Date(item.plannedAt).toISOString(),
    editor_needed: false,
    tts: true,
  };
  // Immer Edge-TTS (nie Gemini): garantiert MP3 und kein Tageskontingent, das den 24/7-Betrieb
  // oder den Live-Stream unterbrechen könnte. hostId sorgt bei Personas, die sich eine der nur
  // 10 verfügbaren deutschen Stimmen mit einer Moderation teilen müssen, für eine kleine, feste
  // Tonhöhen-Verschiebung, damit sie trotzdem wie eine eigene Stimme klingen (siehe PERSONA_PITCH).
  const raw = await synthesizeSpeechMp3Only(
    finalText,
    item.voice ?? "alloy",
    item.kind,
    item.hostId,
  );
  const { buffer: voice, duration: voiceDuration } = trimToAudio(raw, item.duration);
  // Mehrspur: Musikbett unter einem kurzen Callout (Regel 6) – mischt der Sendemischer live
  // darunter. Fehlt es, läuft die Ansage einfach ohne Bett.
  let bed: Buffer | undefined;
  if (item.bed) {
    try {
      const bedRaw = item.bed.mediaId
        ? await getStoredFileBuffer(item.bed.mediaId)
        : item.bed.streamUrl
          ? await fetchBufferWithTimeout(rawStreamUrl(item.bed.streamUrl), 30_000)
          : null;
      if (bedRaw) bed = trimToAudio(bedRaw, 0).buffer;
    } catch (err) {
      console.error("[station-engine] Bett nicht ladbar:", item.title, err);
    }
  }
  return { buffer: voice, contentType: "audio/mpeg", duration: voiceDuration, bed };
}

/** Welche Warteschlange eine Mehrspur-Bearbeitung meint: die gerade sendende (Autopilot-Plan
 *  bzw. Live-Warteschlange im Livestudio) oder ausdrücklich die Live-Warteschlange – die lässt sich
 *  auch vorbereiten, während noch der Autopilot sendet. */
export type QueueName = "active" | "live";

function queueOf(state: EngineState, name: QueueName): PlanItem[] {
  return name === "live" ? state.liveQueue : activeQueue(state);
}
function setQueueOf(state: EngineState, name: QueueName, next: PlanItem[]) {
  if (name === "live") state.liveQueue = next;
  else setActiveQueue(state, next);
}
/** Sendet diese Warteschlange gerade (dann ist ihr erstes Element on air und fest)? */
function isOnAir(state: EngineState, name: QueueName) {
  return name === "active" || state.liveMode;
}

/** Startzeiten nach einer Bearbeitung neu durchrechnen (inkl. Überlappungen). */
function recalcTimes(state: EngineState, name: QueueName = "active") {
  const queue = queueOf(state, name);
  const current = queue[0];
  if (!current) return;
  const onAir = isOnAir(state, name) && state.currentStartedAt !== null;
  if (!onAir) current.plannedAt = Date.now();
  let t = onAir
    ? state.currentStartedAt! + current.duration * 1000
    : current.plannedAt + current.duration * 1000;
  let prev: PlanItem = current;
  for (const item of queue.slice(1)) {
    item.plannedAt = t - effectiveOverlap(prev, item) * 1000;
    t = item.plannedAt + item.duration * 1000;
    prev = item;
  }
}

function ensureAudioPreparing(state: EngineState) {
  const upcoming = activeQueue(state).slice(0, PREPARE_AHEAD);
  for (const item of upcoming) {
    if (item.kind === "mic") continue; // kein Audio zum Vorbereiten – kommt live rein
    if (state.audioCache.has(item.uid) || state.preparing.has(item.uid)) continue;
    state.preparing.add(item.uid);
    withTimeout(prepareAudio(item), PREPARE_TIMEOUT_MS, "Audio-Vorbereitung")
      .then((entry) => {
        if (!entry) throw new Error("kein Audio verfügbar");
        state.prepareFailures.delete(item.uid);
        state.audioCache.set(item.uid, entry);
        // Die geplante Dauer war nur eine Schätzung (Textlänge bzw. Musik-Metadaten) – jetzt auf
        // die tatsächlich gemessene Länge korrigieren, sonst wartet der Sendeplan nach Ende der
        // Audiodatei noch auf die (zu lange) Schätzung = stille Pause, oder schneidet bei einer
        // zu kurzen Schätzung noch laufendes Audio ab.
        if (entry.duration > 0) item.duration = entry.duration;
      })
      .catch((err) => {
        if (err instanceof EditorHoldError) {
          console.warn("[station-engine] An Redaktion übergeben:", item.title, err.reason);
          state.editorHolds = [
            {
              uid: item.uid,
              kind: item.kind,
              title: item.title,
              plannedAt: item.plannedAt,
              reason: err.reason,
              text: err.text,
              heldAt: Date.now(),
            },
            ...state.editorHolds,
          ].slice(0, 50);
          const queue = activeQueue(state);
          if (queue[0]?.uid === item.uid) {
            stopDeck(item.uid);
            state.currentStartedAt = null;
          }
          setActiveQueue(
            state,
            queue.filter((i) => i.uid !== item.uid),
          );
          return;
        }
        console.error("[station-engine] Audio fehlgeschlagen:", item.title, err);
        // Ohne Audio kann das Element nie starten – advanceQueue() würde dann ewig davor warten
        // (der Sendeplan "hängt"). Nach einigen Fehlversuchen daher einfach überspringen.
        const failures = (state.prepareFailures.get(item.uid) ?? 0) + 1;
        state.prepareFailures.set(item.uid, failures);
        if (failures >= MAX_PREPARE_FAILURES) {
          state.prepareFailures.delete(item.uid);
          const queue = activeQueue(state);
          if (queue.some((i) => i.uid === item.uid)) {
            console.warn("[station-engine] Element übersprungen (kein Audio):", item.title);
            if (queue[0]?.uid === item.uid) {
              stopDeck(item.uid);
              state.currentStartedAt = null;
            }
            setActiveQueue(
              state,
              queue.filter((i) => i.uid !== item.uid),
            );
          }
        }
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
      talkoverSeconds: i.mixed ? undefined : i.talkoverSeconds,
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
async function tickAutopilotPlanning(state: EngineState) {
  const now = Date.now();
  const hardIdx = state.plan.findIndex(
    (i) => i.hardStart && i.hardStart <= now && i.hardStart > now - 90_000,
  );
  // Nur springen, wenn das Zielelement (z. B. die Nachrichten) schon fertig vorbereitet ist –
  // sonst würde der Sprung selbst eine hörbare Stille erzeugen (Timer läuft schon, Audio fehlt
  // noch). Ein paar Sekunden Zeitplan-Drift sind unhörbar, eine Stille im Livestream nicht.
  if (hardIdx > 0 && state.audioCache.has(state.plan[hardIdx].uid)) {
    // Feste Zeitmarke (Nachrichten): Laufendes kurz ausblenden, dann sofort die Marke.
    stopDeck(state.plan[0].uid, 0.8);
    state.plan = state.plan.slice(hardIdx);
    state.currentStartedAt = null;
  }

  const totalPlanned = state.plan.reduce((sum, i) => sum + i.duration, 0);
  if (state.plan.length === 0) {
    state.plan = buildPlan({
      from: new Date(),
      hours: REFILL_HOURS,
      ctx: await buildContext(state),
    });
  } else if (totalPlanned < REFILL_THRESHOLD_SECONDS) {
    const last = state.plan[state.plan.length - 1];
    const from = new Date(last.plannedAt + last.duration * 1000);
    const more = buildPlan({ from, hours: REFILL_HOURS, ctx: await buildContext(state) });
    state.plan = [...state.plan, ...more];
  }
}

/** Regel 3: wichtige Verkehrslagen "sofort" – höchstens einmal pro Minute prüfen (braucht die
 *  Hotline aus der DB), neue Sofort-Lagen direkt hinter das laufende Element setzen. Beim ersten
 *  Durchlauf nach dem Start werden bestehende Lagen nur als bekannt markiert – die laufen ohnehin
 *  im nächsten regulären Verkehrsblock, ein Neustart soll keine Flut an Sofortmeldungen auslösen. */
async function tickUrgentTraffic(state: EngineState) {
  const now = Date.now();
  if (now - state.urgentCheckedAt < 60_000) return;
  const firstRun = state.urgentCheckedAt === 0;
  state.urgentCheckedAt = now;
  const ctx = await buildContext(state);
  const current = state.plan[0];
  const at =
    current && state.currentStartedAt ? state.currentStartedAt + current.duration * 1000 : now;
  const { items, ids } = urgentTrafficItems(ctx, at, state.urgentAnnounced);
  ids.forEach((id) => state.urgentAnnounced.add(id));
  if (firstRun || !items.length) return;
  console.log("[station-engine] Sofort-Verkehrsmeldung eingeplant:", ids.join(", "));
  state.plan = [...state.plan.slice(0, 1), ...items, ...state.plan.slice(1)];
}

/** Element on air schalten: Startzeit setzen und als Deck in den Sendemischer geben. */
function startOnAir(state: EngineState, item: PlanItem, fadeOthersSeconds: number) {
  state.currentStartedAt = Date.now();
  if (item.kind === "mic") {
    startMicDeck(item.uid);
    return;
  }
  const entry = state.audioCache.get(item.uid);
  if (!entry) return;
  playDeck({
    uid: item.uid,
    role: item.kind === "music" ? "music" : item.mediaId || item.streamUrl ? "fx" : "voice",
    audio: entry.buffer,
    bed: entry.bed ?? null,
    fadeOthersSeconds,
  });
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
        startOnAir(state, current, 0);
      }
      break;
    }
    const elapsed = (Date.now() - state.currentStartedAt) / 1000;
    // Mehrspur/automatische Regie: das nächste Element startet schon vor dem Ende des aktuellen
    // (Ansage über Song-Ausklang, Song unter Ansage-Ende, Jingle über Song-Ende). Das aktuelle
    // Deck läuft im Sendemischer einfach weiter aus.
    const next = queue[1];
    const overlap = next ? effectiveOverlap(current, next) : 0;
    if (
      next &&
      overlap > 0 &&
      elapsed >= current.duration - overlap &&
      state.audioCache.has(next.uid)
    ) {
      state.audioCache.delete(current.uid);
      setActiveQueue(state, queue.slice(1));
      startOnAir(state, next, current.kind === "music" && next.kind === "jingle" ? overlap : 0);
      continue;
    }
    if (elapsed < current.duration) break;
    state.audioCache.delete(current.uid);
    setActiveQueue(state, queue.slice(1));
    state.currentStartedAt = null;
  }
}

async function tick() {
  const state = getState();
  if (state.running) {
    // Ein einziger nie zurückkehrender await (Feed, DB, KI) würde sonst die Engine für immer
    // blockieren – der Sendeplan "hängt". Nach 2 Minuten den alten Tick aufgeben.
    if (Date.now() - state.runningSince < TICK_STUCK_MS) return;
    console.warn("[station-engine] Tick hing seit über 2 Minuten – wird neu gestartet.");
  }
  state.running = true;
  state.runningSince = Date.now();
  try {
    await refreshFeeds(state);

    tickScheduledShows(state);

    if (!state.liveMode) {
      await tickAutopilotPlanning(state);
      await tickUrgentTraffic(state);
    }

    ensureAudioPreparing(state);
    advanceQueue(state);
    publishNowPlaying(state);
  } catch (err) {
    console.error("[station-engine] Tick-Fehler:", err);
  } finally {
    state.running = false;
  }
}

/** Neue:r Hörer:in für /live-stream – der durchgehende Stream aus dem Sendemischer. */
export function subscribeLive(): ReadableStream<Uint8Array> {
  return subscribeStream();
}

/** MP3-Chunk vom Mikrofon-Ingest (/api/mic-stream) – nur wirksam, während wirklich ein
 *  "mic"-Element läuft (Schutz gegen Bytes zur falschen Zeit). */
export function pushMicAudioChunk(buffer: Buffer) {
  const state = getState();
  const current = activeQueue(state)[0];
  if (!current || current.kind !== "mic") return;
  pushMicChunk(current.uid, buffer);
}

export function startStationEngine() {
  const state = getState();
  if (state.timer) return;
  startMixer();
  try {
    state.timer = setInterval(() => void tick(), TICK_MS);
  } catch {
    // Cloudflare Workers verbieten Timer im Global Scope (= beim Modul-Import, wo die Routen
    // diese Funktion aufrufen). Kein Fehler: state.timer bleibt null, der nächste Aufruf
    // innerhalb eines Requests (siehe server.ts) startet die Engine dann regulär.
    return;
  }
  console.log("[station-engine] Autonome Sende-Engine gestartet.");
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

export type PlanEdit =
  | { action: "move"; uid: string; beforeUid: string | null }
  | { action: "overlap"; uid: string; seconds: number | null }
  | { action: "bed"; uid: string; on: boolean }
  | { action: "remove"; uid: string };

/**
 * Bearbeitung aus der Mehrspur-Ansicht. Das gerade laufende Element und harte Zeitmarken
 * (Nachrichten) bleiben fest; Überlappung und Bett nur dort, wo die Regeln es erlauben.
 */
export function editPlan(
  edit: PlanEdit,
  queueName: QueueName = "active",
): { ok: true } | { ok: false; error: string } {
  const state = getState();
  const queue = [...queueOf(state, queueName)];
  const onAir = isOnAir(state, queueName);
  const index = queue.findIndex((i) => i.uid === edit.uid);
  if (index < 0) return { ok: false, error: "Element nicht (mehr) im Plan" };
  if (index === 0 && onAir) {
    return { ok: false, error: "Das laufende Element kann nicht bearbeitet werden" };
  }
  const item = queue[index];
  const invalidate = (i: PlanItem) => {
    state.audioCache.delete(i.uid);
    i.mixed = false;
  };

  if (edit.action === "remove") {
    queue.splice(index, 1);
    state.audioCache.delete(item.uid);
  } else if (edit.action === "move") {
    if (item.hardStart)
      return { ok: false, error: "Feste Zeitmarken (Nachrichten) bleiben an ihrem Platz" };
    queue.splice(index, 1);
    const target = edit.beforeUid ? queue.findIndex((i) => i.uid === edit.beforeUid) : queue.length;
    if (target === 0 && onAir) {
      return { ok: false, error: "Vor das laufende Element kann nichts geschoben werden" };
    }
    queue.splice(target < 0 ? queue.length : target, 0, item);
    // Überlappungen/Mischungen passen nach dem Verschieben nicht mehr zum neuen Nachbarn.
    for (const i of queue.slice(1)) if (i.mixed) invalidate(i);
  } else if (edit.action === "overlap") {
    // null = automatische Regie entscheidet; Zahl (auch 0) = Handeinstellung.
    const reason = overlapForbidden(queue[index - 1], item);
    if (reason && edit.seconds) return { ok: false, error: `Keine Überlappung: ${reason}` };
    item.overlapSeconds =
      edit.seconds === null ? undefined : Math.max(0, Math.min(8, edit.seconds));
  } else if (edit.action === "bed") {
    if (edit.on) {
      const spoken = Boolean(item.text) && !item.mediaId && !item.streamUrl;
      if (!spoken || wordCount(item.text ?? "") > OVERLAY_WORDS_MAX || item.civilWarning) {
        return { ok: false, error: "Ein Bett gibt es nur unter kurzen Ansagen (max. 5 Wörter)" };
      }
      const beds = state.media.items.filter((m) => m.kind === "jingle" && m.slot === "bett");
      if (!beds.length)
        return { ok: false, error: "Keine Musikbetten in der Bibliothek (Slot „Musikbett“)" };
      const b = beds[Math.floor(Math.random() * beds.length)];
      item.bed = {
        mediaId: b.streamUrl ? undefined : b.id,
        streamUrl: b.streamUrl,
        title: b.title,
      };
    } else {
      item.bed = undefined;
    }
    invalidate(item);
  }
  setQueueOf(state, queueName, queue);
  recalcTimes(state, queueName);
  return { ok: true };
}

/** Studio-Steuerung: das aktuelle Element der echten Sendung sofort beenden und weiterschalten
 *  (Autopilot) bzw. das aktuelle Live-Element beenden (Livestudio). */
export function forceSkipCurrent(): boolean {
  const state = getState();
  const queue = activeQueue(state);
  const current = queue[0];
  if (!current) return false;
  stopDeck(current.uid);
  state.audioCache.delete(current.uid);
  setActiveQueue(state, queue.slice(1));
  state.currentStartedAt = null;
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
  stopAllDecks();
  state.currentStartedAt = null;
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
    track: input.kind === "music" ? "music" : input.mediaId || input.streamUrl ? "fx" : "voice",
  };
  if (playNow) {
    const current = state.liveQueue[0];
    if (current) {
      if (state.liveMode) stopDeck(current.uid);
      state.audioCache.delete(current.uid);
    }
    state.liveQueue = [item, ...state.liveQueue.slice(current ? 1 : 0)];
    state.currentStartedAt = null;
  } else {
    state.liveQueue = [...state.liveQueue, item];
  }
  recalcTimes(state, "live");
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
  recalcTimes(state, "live");
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
  recalcTimes(state, "live");
}

export function getLiveQueue(): PlanItem[] {
  return getState().liveQueue;
}

/** Aktueller Verkehrs-Snapshot (offizielle Autobahn-API + RSS) – für die öffentliche
 *  Staus/Blitzer-Übersicht auf der Homepage (siehe /api/public/traffic-overview). */
/** Für den Produktions-Export (/api/production): aktueller Plan + an die Redaktion übergebene
 *  Elemente. */
export function getProductionSnapshot(queueName: QueueName = "active"): {
  plan: PlanItem[];
  liveMode: boolean;
  currentStartedAt: number | null;
  editorHolds: EditorHold[];
  onAir: boolean;
} {
  const state = getState();
  if (queueName === "live" && !state.liveMode) recalcTimes(state, "live");
  return {
    plan: queueOf(state, queueName),
    liveMode: state.liveMode,
    currentStartedAt: isOnAir(state, queueName) ? state.currentStartedAt : null,
    editorHolds: state.editorHolds,
    onAir: isOnAir(state, queueName),
  };
}

export function getTrafficSnapshot(): TrafficFeedItem[] {
  return mergedTraffic(getState());
}

/** Aktuelle Blitzer von Radio Salü/RPR1 (für die öffentliche Übersicht). */
export function getStationBlitzerSnapshot(): StoredStationReport[] {
  return getState().stationReports.items.filter((r) => r.type === "blitzer");
}

/** Aktueller Nachrichten-Snapshot – für die öffentliche News-Seite (siehe /api/public/news-page). */
export function getNewsSnapshot(): NewsFeedItem[] {
  return getState().news.items;
}

/** Heutiges Tagesthema je Sendung (id → Thema) – für die Redaktions-Ansicht im Studio. */
export function getDailyThemes(): Record<string, string> {
  return getState().dailyThemes.items;
}

/** Redaktion legt das Tagesthema einer Sendung manuell fest (statt der KI-Auswahl aus den
 *  Top-Nachrichten, siehe ensureDailyThemes) - z. B. für ein großes lokales Ereignis, das die KI
 *  mangels Kontingent gerade nicht selbst erkennen kann (siehe Nutzer-Feedback zum SVE-Sieg als
 *  Tagesthema). Schreibt direkt in den laufenden Engine-Zustand, damit die Änderung SOFORT wirkt -
 *  ohne das würde der bereits im Speicher zwischengespeicherte Wert (siehe ensureDailyThemes'
 *  "items[show.id]"-Cache-Check) bis zum nächsten Kalendertag stehen bleiben. */
export async function setDailyThemeOverride(showId: string, topic: string): Promise<void> {
  const state = getState();
  const today = berlinDateKey(Date.now());
  await setTopicForDate(showId, topic, today);
  // Nur Themen ANDERER Sendungen vom selben Kalendertag übernehmen - sonst würden bei einem noch
  // nicht aktualisierten Zustand (state.dailyThemesDate ist noch der Vortag) versehentlich gestrige
  // Themen unter dem heutigen Datum weiterleben.
  const carryOver = state.dailyThemesDate === today ? state.dailyThemes.items : {};
  state.dailyThemesDate = today;
  state.dailyThemes = { items: { ...carryOver, [showId]: topic }, at: Date.now() };
}
