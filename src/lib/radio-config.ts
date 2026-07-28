/** Moderator:innen, 4-Stunden-Sendungen, Sponsoren und Stundenuhr. */

export type Host = {
  id: string;
  name: string;
  /** KI-Stimme des TTS-Modells */
  voice: string;
  persona: string;
  humor: "trocken" | "warm" | "frech" | "sachlich" | "verspielt";
};

export const HOSTS: Host[] = [
  {
    id: "h1",
    name: "Max Mustermann",
    voice: "onyx",
    persona: "Ruhiger Abendmoderator, Musikkenner, viele Anekdoten aus der Region.",
    humor: "trocken",
  },
  {
    id: "h2",
    name: "Lena Bergmann",
    voice: "shimmer",
    persona: "Gute-Laune-Morgenstimme, direkt, viel Tempo, liebt kleine Alltagsgeschichten.",
    humor: "frech",
  },
  {
    id: "h3",
    name: "Tobias Kern",
    voice: "alloy",
    persona: "Vormittagsmoderator, Servicethemen, Verbrauchertipps, freundlich erklärend.",
    humor: "warm",
  },
  {
    id: "h4",
    name: "Jana Weiler",
    voice: "nova",
    persona: "Nachmittagsstimme mit Fokus auf Verkehr, Feierabend und Wochenendtipps.",
    humor: "verspielt",
  },
  {
    id: "h5",
    name: "Rolf Steiner",
    voice: "echo",
    persona: "Nachrichtenerfahren, seriös, ordnet Hintergründe ein.",
    humor: "sachlich",
  },
  {
    id: "h6",
    name: "Mira Sandhoff",
    voice: "coral",
    persona: "Nachtwelle, sanfte Stimme, ruhige Musikfarbe, viel Hörerkontakt.",
    humor: "warm",
  },
  {
    id: "h7",
    name: "Ben Achterberg",
    voice: "ash",
    persona: "Wochenend-Party, Charts, laut, schnell, Comedy-Einlagen.",
    humor: "frech",
  },
  {
    id: "h8",
    name: "Sophie Reinhardt",
    voice: "sage",
    persona: "Kultur, Regionales, Interviews, feine Ironie.",
    humor: "trocken",
  },
  {
    id: "h9",
    name: "David Lauth",
    voice: "ballad",
    persona: "Sonntagsmoderation, entspannt, Classics und Geschichten.",
    humor: "warm",
  },
  {
    id: "h10",
    name: "Ayse Demir",
    voice: "verse",
    persona: "Junge Welle, Trends, Netzthemen, sehr spontan.",
    humor: "verspielt",
  },
];

export const hostById = (id: string) => HOSTS.find((h) => h.id === id) ?? HOSTS[0];

export type Sponsor = {
  id: string;
  slot: "wetter" | "verkehr" | "nachrichten";
  name: string;
  claim: string;
};

/**
 * Sponsoren werden erst eingetragen, wenn es echte Kunden gibt.
 * Solange die Liste leer ist, läuft weder Werbung noch eine Sponsoren-Ansage.
 */
export const SPONSORS: Sponsor[] = [];

export const sponsorFor = (slot: Sponsor["slot"]) => SPONSORS.find((s) => s.slot === slot) ?? null;

export type Show = {
  id: string;
  /** Startstunde des 4h-Blocks: 0, 4, 8, 12, 16 oder 20 */
  startHour: number;
  title: string;
  weekdayHostId: string;
  weekendHostId: string;
  colour: string;
  topics: string[];
};

export const SHOWS: Show[] = [
  {
    id: "sh0",
    startHour: 0,
    title: "Welle Südwest in der Nacht",
    weekdayHostId: "h6",
    weekendHostId: "h9",
    colour: "Ruhige Classics & Softpop",
    topics: ["Hörergrüße", "Nachtgedanken", "Musikgeschichten"],
  },
  {
    id: "sh4",
    startHour: 4,
    title: "Welle Südwest am Morgen",
    weekdayHostId: "h2",
    weekendHostId: "h10",
    colour: "Wacher Pop & aktuelle Charts",
    topics: ["Wetter & Weg zur Arbeit", "Kurioses vom Morgen", "Was heute wichtig wird"],
  },
  {
    id: "sh8",
    startHour: 8,
    title: "Welle Südwest am Vormittag",
    weekdayHostId: "h3",
    weekendHostId: "h8",
    colour: "Bunter Mix & Deutschpop",
    topics: ["Servicethemen", "Verbrauchertipps", "Region im Gespräch"],
  },
  {
    id: "sh12",
    startHour: 12,
    title: "Welle Südwest am Mittag",
    weekdayHostId: "h8",
    weekendHostId: "h7",
    colour: "Leichte Kost, Hits von heute",
    topics: ["Mittagsthema", "Kultur & Termine", "Witziges aus dem Netz"],
  },
  {
    id: "sh16",
    startHour: 16,
    title: "Welle Südwest am Nachmittag",
    weekdayHostId: "h4",
    weekendHostId: "h7",
    colour: "Feierabend-Energie",
    topics: ["Verkehr & Feierabend", "Wochenendtipps", "Hörerfrage des Tages"],
  },
  {
    id: "sh20",
    startHour: 20,
    title: "Welle Südwest am Abend",
    weekdayHostId: "h1",
    weekendHostId: "h9",
    colour: "Ruhiger Abendsound",
    topics: ["Rückblick auf den Tag", "Musikspecial", "Anekdoten aus der Region"],
  },
];

export function showForDate(date: Date) {
  const startHour = Math.floor(date.getHours() / 4) * 4;
  const show = SHOWS.find((s) => s.startHour === startHour) ?? SHOWS[0];
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  const host = hostById(weekend ? show.weekendHostId : show.weekdayHostId);
  return { show, host, weekend, startHour };
}

export const showTitleWithHost = (show: Show, host: Host) => `${show.title} mit ${host.name}`;

/** Stundenuhr: fester Ablauf innerhalb einer Sendestunde. */
export type ClockSlot =
  | "jingle"
  | "showopener"
  | "music"
  | "moderation"
  | "news"
  | "traffic"
  | "weather"
  | "ad"
  | "slogan";

export const HOUR_CLOCK: ClockSlot[] = [
  "news",
  "jingle",
  "music",
  "traffic",
  "music",
  "moderation",
  "music",
  "ad",
  "music",
  "weather",
  "music",
  "slogan",
  "music",
  "moderation",
  "music",
  "ad",
  "music",
];

/** Stoßzeiten: zusätzliche Nachrichten- und Verkehrsblöcke zur halben Stunde. */
export const RUSH_HOURS = [6, 7, 8, 14, 15, 17, 18];

export const isRushHour = (hour: number) => RUSH_HOURS.includes(hour);
