import type { MediaRecord } from "./media-db";

export type ItemKind =
  | "music"
  | "jingle"
  | "showopener"
  | "moderation"
  | "news"
  | "traffic"
  | "weather"
  | "ad"
  | "slogan"
  | "recording"
  | "mic";

export type PrepStatus = "idle" | "preparing" | "ready" | "error";

export type PlanItem = {
  uid: string;
  kind: ItemKind;
  title: string;
  subtitle: string;
  duration: number;
  /** Grobe Schätzung, wie lange das Intro eines Musiktitels instrumental sein dürfte (nur bei
   *  kind "music" gesetzt) – Richtwert für die Studio-Anzeige, keine echte Gesangserkennung. */
  introSeconds?: number;
  /** Geplante Startzeit (Epoch ms) */
  plannedAt: number;
  /** Sprechtext für die KI-Stimme */
  text?: string;
  voice?: string;
  /** Verweis auf hochgeladene Datei in der Medien-Datenbank */
  mediaId?: string;
  /** Direkte Stream-URL (freie Musik aus dem Netz) */
  streamUrl?: string;
  /** Lizenz + Quelle (Nachweispflicht bei freier Musik) */
  license?: string;
  source?: string;
  /** Harte Zeitmarke: muss exakt zu dieser Uhrzeit starten (Epoch ms) */
  hardStart?: number;
  /** Vorhören/Freigabe nötig, bevor das Element on air darf */
  needsApproval?: boolean;
  approved?: boolean;
  showId?: string;
  hostId?: string;
  hostName?: string;
  sponsor?: string | null;
  status: PrepStatus;
  /** Themen-Vorschau: gewählte Rubrik dieser Moderation */
  topicCat?: string;
  /** Rubriken, die im Plan bereits abgedeckt sind */
  topicCovered?: string[];
  /** Rubriken, die noch offen sind */
  topicOpen?: string[];
  /** true, wenn der Planer ein Ersatzthema gewählt hat */
  topicFallback?: boolean;
  /** Begründung/Regel, warum der Planer dieses Thema gewählt hat */
  topicRule?: string;
  /** Gesetzt bei einer 2er-Show: dieses Element ist die Reaktion der zweiten Stimme auf das
   *  Thema, über das die Hauptmoderation gerade gesprochen hat – für ein echtes, themenbezogenes
   *  Gespräch statt einer beliebigen, austauschbaren Bemerkung. */
  dialogueTopic?: string;
  /** Markiert eine Sendungs-Übergabe (Verabschiedung + Vorstellung der nächsten Sendung) – wird
   *  faktentreu umformuliert (Namen/Uhrzeiten fest), nicht frei wie normale Moderation. */
  handoff?: boolean;
  /** Markiert einen Korrespondent:innen-Bericht, der sich auf eine echte aktuelle Meldung
   *  bezieht – wird faktentreu umformuliert (Fakten fest), nicht frei erfunden wie normale
   *  Moderation. */
  correspondentReport?: boolean;
  /** Markiert ein automatisches Hörer-Hotline-Sammelsegment (Gruß/Musikwunsch/Lob & Kritik/
   *  Sonstiges) – Kern jeder Meldung (Namen, Wunsch, Anliegen) bleibt fest, nur die Verbindung
   *  zwischen den Meldungen wird frei formuliert (siehe pushHotlineMix in planner.ts). */
  hotlineMix?: boolean;
  error?: string;
  /** Objekt-URL des fertig generierten bzw. hochgeladenen Audios */
  audioUrl?: string;
  /** true, sobald das Audio aus dem 48h-Cache kam */
  fromCache?: boolean;
};

export type NewsFeedItem = {
  id: string;
  region: "Saarland" | "Rheinland-Pfalz" | "Deutschland" | "Welt";
  source: string;
  headline: string;
  body: string;
  link?: string;
  publishedAt?: string;
};

export type TrafficFeedItem = {
  id: string;
  road: string;
  region: "Saarland" | "Rheinland-Pfalz";
  headline: string;
  message: string;
  since?: string | null;
};

export type Report = {
  id: string;
  author: string;
  title: string;
  body: string;
  region: "Saarland" | "Rheinland-Pfalz" | "Welt";
  approved: boolean;
  createdAt: number;
};

/** Art einer Hörermeldung – nicht mehr nur Verkehr, sondern alles, was Hörer:innen melden wollen. */
export type HotlineReportType =
  "verkehr" | "blitzer" | "wetter" | "gruss" | "musikwunsch" | "lob_kritik" | "sonstiges";

/** Live-Meldung aus der Hörer-Hotline. */
export type HotlineReport = {
  id: string;
  type: HotlineReportType;
  region: "Saarland" | "Rheinland-Pfalz";
  place: string;
  road: string;
  message: string;
  caller: string;
  /** Optionale Rückrufmöglichkeit (E-Mail/Telefon) – wird nie on air genannt. */
  contact: string;
  createdAt: number;
};

export type LogEntry = {
  id: string;
  at: number;
  level: "info" | "warn" | "error";
  message: string;
};

export type PlanContext = {
  media: MediaRecord[];
  news: NewsFeedItem[];
  traffic: TrafficFeedItem[];
  reports: Report[];
  /** Live-Meldungen der Hörer (Blitzer, Staus, Gefahren) */
  hotline?: HotlineReport[];
  /** Kostenlose, kommerziell nutzbare Musik aus dem Netz */
  freeMusic?: FreeTrack[];
  /** Freigegebene Werbekunden (nur nach erfolgreicher Bewerbung) */
  adCampaigns?: AdCampaign[];
  /** Vorab geplante Livesendungen – in diesen Fenstern plant der Autopilot nichts */
  liveSlots?: LiveSlot[];
  /** Tagesthema je Sendung (showId -> Thema), wiederholt sich nicht innerhalb von 90 Tagen –
   *  siehe show-topics-store.ts / ensureDailyThemes in station-engine.ts. */
  dailyThemes?: Record<string, string>;
  /** IDs bereits automatisch vorgelesener Hotline-Meldungen (siehe pushHotlineMix in planner.ts) –
   *  verhindert, dass dieselbe Gruß-/Musikwunsch-/Lob&Kritik-Meldung stundenlang wiederholt wird. */
  hotlineAnnouncedIds?: string[];
  /** Markiert Hotline-Meldungen als "schon automatisch vorgelesen" – von station-engine.ts an den
   *  echten Speicher (hotline-store.ts) angebunden; planner.ts selbst bleibt frei von Server-
   *  Imports, damit es weiterhin auch von der alten, rein clientseitigen Simulation genutzt
   *  werden kann (use-radio-engine.ts), die diesen Callback einfach nicht setzt. */
  markHotlineAnnounced?: (ids: string[]) => void;
  /** KI-Moderationen, Werbung und Nachrichten erst nach Freigabe senden */
  approvalRequired?: boolean;
};

/** Werbe-Bewerbung: Werbung läuft erst nach Prüfung und Freigabe. */
export type AdCampaign = {
  id: string;
  advertiser: string;
  contact: string;
  text: string;
  /** eingereicht → geprüft → freigegeben / abgelehnt */
  status: "eingereicht" | "geprueft" | "freigegeben" | "abgelehnt";
  perHour: number;
  createdAt: number;
};

/** Vorab geplante Livesendung (manuell moderiert). */
export type LiveSlot = {
  id: string;
  title: string;
  hostId: string;
  hostName: string;
  /** Startzeit (Epoch ms) und Dauer in Minuten */
  startAt: number;
  minutes: number;
  note: string;
};

export type FreeTrack = {
  id: string;
  title: string;
  artist: string;
  category: string;
  duration: number;
  streamUrl: string;
  license: string;
  source: string;
};
