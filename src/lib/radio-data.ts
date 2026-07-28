export type Voice = {
  id: string;
  name: string;
  role: string;
};

// Stimmen des kostenlosen Gemini-TTS-Modells (siehe VOICE_MAP in routes/api/tts.ts)
export const VOICES: Voice[] = [
  { id: "alloy", name: "Alex", role: "Hauptmoderation" },
  { id: "shimmer", name: "Mira", role: "Co-Moderation" },
  { id: "onyx", name: "Rolf", role: "Nachrichten" },
  { id: "nova", name: "Jana", role: "Verkehr" },
  { id: "echo", name: "Ben", role: "Werbung / Trailer" },
];

export const SLOGANS = [
  "Welle Südwest – dein Sound zwischen Saar und Rhein.",
  "Welle Südwest – immer eine Spur schneller durch den Stau.",
  "Musik, die bleibt. Nachrichten, die zählen. Welle Südwest.",
  "Von Saarbrücken bis Mainz – wir spielen deinen Tag.",
  "Welle Südwest – hier läuft die Region.",
  "Welle Südwest – die besten Hits für Saarland und Rheinland-Pfalz.",
  "Mehr Musik, weniger Gerede. Welle Südwest.",
  "Welle Südwest – Verkehr aktuell, alle dreißig Minuten.",
  "Guten Morgen, Südwest. Guten Morgen, Welle Südwest.",
  "Welle Südwest – wir bringen dich sicher durch den Tag.",
  "Deine Region, deine Musik: Welle Südwest.",
  "Welle Südwest – Nachrichten pünktlich zur vollen Stunde.",
  "Zwischen Mosel, Saar und Pfalz: Welle Südwest.",
  "Welle Südwest – der Feierabend beginnt hier.",
  "Die Nacht gehört dir. Welle Südwest.",
];

export type Track = {
  id: string;
  artist: string;
  title: string;
  duration: number; // Sekunden
  category: "Pop" | "Rock" | "Dance" | "Deutsch" | "Classics";
};

export const MUSIC_LIBRARY: Track[] = [
  { id: "m1", artist: "Nachtblende", title: "Saarbrücken Lights", duration: 212, category: "Pop" },
  { id: "m2", artist: "Rheinstrom", title: "Über die Brücke", duration: 198, category: "Deutsch" },
  { id: "m3", artist: "Kalte Sonne", title: "Hunsrück Highway", duration: 245, category: "Rock" },
  { id: "m4", artist: "Elektrisch Süd", title: "Moselwelle", duration: 187, category: "Dance" },
  { id: "m5", artist: "Ana Feld", title: "Bis Kaiserslautern", duration: 203, category: "Pop" },
  {
    id: "m6",
    artist: "Tramline",
    title: "Letzte Bahn nach Trier",
    duration: 231,
    category: "Classics",
  },
  { id: "m7", artist: "Hallwerk", title: "Völklinger Hütte", duration: 256, category: "Rock" },
  { id: "m8", artist: "Sommerkanal", title: "Pfälzer Wald", duration: 176, category: "Deutsch" },
  { id: "m9", artist: "Neon Ost", title: "Mainzer Nächte", duration: 219, category: "Dance" },
  { id: "m10", artist: "Leise Kollektiv", title: "Nahetal", duration: 240, category: "Classics" },
];

export type Spot = {
  id: string;
  advertiser: string;
  text: string;
  duration: number;
};

export const AD_SPOTS: Spot[] = [
  {
    id: "a1",
    advertiser: "Autohaus Kern, Neunkirchen",
    text: "Autohaus Kern in Neunkirchen – Frühjahrscheck jetzt zum Festpreis. Termine online oder direkt vor Ort.",
    duration: 22,
  },
  {
    id: "a2",
    advertiser: "Pfalzmarkt",
    text: "Pfalzmarkt – frisch geerntet, direkt aus der Region. Diese Woche: Spargel aus der Vorderpfalz.",
    duration: 20,
  },
  {
    id: "a3",
    advertiser: "Stadtwerke Trier",
    text: "Stadtwerke Trier: Ökostrom aus der Region, fair und planbar. Jetzt Tarif wechseln.",
    duration: 18,
  },
];

export type NewsItem = {
  id: string;
  region: "Saarland" | "Rheinland-Pfalz" | "Welt";
  headline: string;
  body: string;
};

export const NEWS_POOL: NewsItem[] = [
  {
    id: "n1",
    region: "Saarland",
    headline: "Landtag berät über Industriestrompreis",
    body: "Im saarländischen Landtag geht es heute um Entlastungen für energieintensive Betriebe. Die Stahlindustrie erwartet eine Entscheidung noch vor dem Sommer.",
  },
  {
    id: "n2",
    region: "Saarland",
    headline: "Neue Radwege rund um Saarlouis",
    body: "Der Landkreis Saarlouis baut das Radwegenetz aus. Rund zwölf Kilometer sollen bis Herbst fertig sein.",
  },
  {
    id: "n3",
    region: "Rheinland-Pfalz",
    headline: "Weinlese startet früher als üblich",
    body: "Winzer an Mosel und Nahe rechnen wegen der warmen Witterung mit einem früheren Lesebeginn.",
  },
  {
    id: "n4",
    region: "Rheinland-Pfalz",
    headline: "Mainz investiert in Schulsanierung",
    body: "Die Stadt Mainz stellt zusätzliche Mittel für die Sanierung von Schulgebäuden bereit.",
  },
  {
    id: "n5",
    region: "Welt",
    headline: "Notenbanken halten Kurs",
    body: "Die großen Notenbanken lassen die Leitzinsen unverändert und verweisen auf eine langsam sinkende Inflation.",
  },
  {
    id: "n6",
    region: "Welt",
    headline: "Klimakonferenz einigt sich auf Fahrplan",
    body: "Nach langen Verhandlungen steht ein gemeinsamer Fahrplan für den Ausbau erneuerbarer Energien.",
  },
];

export type TrafficItem = {
  id: string;
  road: string;
  region: "Saarland" | "Rheinland-Pfalz";
  message: string;
  severity: "Info" | "Stau" | "Gefahr";
};

export const TRAFFIC_POOL: TrafficItem[] = [
  {
    id: "t1",
    road: "A620",
    region: "Saarland",
    message:
      "Saarbrücken Richtung Saarlouis, zwischen Klarenthal und Völklingen, drei Kilometer Stau nach einem Unfall.",
    severity: "Stau",
  },
  {
    id: "t2",
    road: "A6",
    region: "Saarland",
    message:
      "Zwischen St. Ingbert und Homburg Fahrbahnverengung wegen Bauarbeiten, zehn Minuten Verzögerung.",
    severity: "Info",
  },
  {
    id: "t3",
    road: "A61",
    region: "Rheinland-Pfalz",
    message:
      "Richtung Koblenz zwischen Rheinböllen und Laudert Gegenstände auf der Fahrbahn – bitte vorsichtig fahren.",
    severity: "Gefahr",
  },
  {
    id: "t4",
    road: "A63",
    region: "Rheinland-Pfalz",
    message: "Kaiserslautern Richtung Mainz, ab Sembach stockender Verkehr im Berufsverkehr.",
    severity: "Stau",
  },
];

export const JINGLES = [
  { id: "j1", name: "Station-ID kurz", duration: 6 },
  { id: "j2", name: "Nachrichten-Opener", duration: 8 },
  { id: "j3", name: "Verkehrs-Sweeper", duration: 5 },
  { id: "j4", name: "Werbe-Trenner", duration: 4 },
];

export function formatClock(totalSeconds: number) {
  const m = Math.floor(Math.max(0, totalSeconds) / 60);
  const s = Math.floor(Math.max(0, totalSeconds) % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
