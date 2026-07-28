import {
  SHOWS,
  showForDate,
  showTitleWithHost,
  sponsorFor,
  hostById,
  newsAnchorFor,
  weatherExpertFor,
  correspondentFor,
  type Host,
  type Correspondent,
} from "./radio-config";
import { SLOGANS } from "./radio-data";
import type { MediaRecord } from "./media-db";
import type { FreeTrack, ItemKind, PlanContext, PlanItem } from "./broadcast-types";
import { liveSlotAt } from "./studio-store";
import { exactSection } from "./autobahn-exits";
import { berlinHour, berlinMinute, berlinDate, berlinMonth, berlinClock } from "./berlin-time";

let counter = 0;
const uid = () => `p${++counter}-${Math.random().toString(36).slice(2, 8)}`;

const pick = <T>(arr: T[], i: number) => arr[Math.abs(i) % arr.length];
const shuffle = <T>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);

/** Geschätzte Sprechdauer eines Textes in Sekunden (ca. 145 Wörter/Minute). */
export function speakDuration(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(8, Math.round((words / 145) * 60));
}

/** Uhrzeit so, wie sie im Radio gesprochen wird: „11 Uhr 45“, „12 Uhr“. Immer deutsche Ortszeit,
 *  unabhängig von der Zeitzone des Servers (Cloud-Hosting läuft oft in UTC). */
export function spokenTime(at: number) {
  const h = berlinHour(at);
  const m = berlinMinute(at);
  return m === 0 ? `${h} Uhr` : `${h} Uhr ${m}`;
}

const clockLine = (at: number) => berlinClock(at);

/** Quellenangaben (Sender/Agenturen) werden im Sprechtext nie genannt. */
const SOURCE_WORDS =
  /\b(ARD|ZDF|SWR|SR|tagesschau|Tagesschau|dpa|DPA|Reuters|AFP|epd|KNA|sol\.de|SOL|Blaulichtreport|SR\s?3|SWR\s?Aktuell|Quelle:?)\b/g;

function clean(value: string) {
  return value
    .replace(SOURCE_WORDS, "")
    .replace(/\|[^|]*$/, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,])/g, "$1")
    .replace(/^[\s,;:–-]+/, "")
    .trim();
}

function cleanTraffic(value: string) {
  return value
    .replace(SOURCE_WORDS, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,])/g, "$1")
    .replace(/^[\s,;:–-]+/, "")
    .trim();
}

const endWithDot = (v: string) => (/[.!?]$/.test(v) ? v : `${v}.`);

/* ---------------------------------------------------------------- Nachrichten */

/** Ortsangabe im Sprechtext – „Welt“ wird nie angesagt. */
function regionLead(region: string, i: number) {
  if (region === "Saarland") return pick(["Im Saarland", "Aus dem Saarland", "Saarland"], i);
  if (region === "Rheinland-Pfalz")
    return pick(["In Rheinland-Pfalz", "Aus Rheinland-Pfalz", "Rheinland-Pfalz"], i);
  return "";
}

const CONNECT = [
  "Weiter geht es mit dieser Meldung.",
  "Und damit zum nächsten Thema.",
  "Kommen wir zu diesem Thema.",
  "Auch das ist heute wichtig.",
  "Und noch eine Meldung.",
];

const CORRESPONDENT = [
  "Mehr dazu hören Sie im Laufe des Tages von unserer Korrespondentin in Mainz.",
  "Unser Korrespondent in Berlin verfolgt die Beratungen und meldet sich später noch einmal.",
  "Wir bleiben an dem Thema dran und melden uns, sobald es Neues gibt.",
];

type Story = { region: string; headline: string; body: string; author?: string };

function newsStories(ctx: PlanContext, limitPerRegion: number): Story[] {
  const byRegion = (region: string) => ctx.news.filter((n) => n.region === region);
  const chosen = [
    ...byRegion("Saarland").slice(0, limitPerRegion),
    ...byRegion("Rheinland-Pfalz").slice(0, limitPerRegion),
    ...byRegion("Welt").slice(0, limitPerRegion),
  ].map((n) => ({ region: n.region, headline: clean(n.headline), body: clean(n.body) }));
  const reports = ctx.reports
    .filter((r) => r.approved)
    .slice(0, 2)
    .map((r) => ({
      region: r.region,
      headline: clean(r.title),
      body: clean(r.body),
      author: r.author,
    }));
  const all = [...chosen, ...reports].filter((s) => s.headline);
  if (all.length) return all;
  return [
    {
      region: "Saarland",
      headline: "Der Landtag berät über Entlastungen für energieintensive Betriebe",
      body: "Die Stahlindustrie erwartet eine Entscheidung noch vor dem Sommer. Die Landesregierung will die Ergebnisse am Nachmittag vorstellen.",
    },
    {
      region: "Rheinland-Pfalz",
      headline: "Die Winzer an Mosel und Nahe rechnen mit einem früheren Lesebeginn",
      body: "Grund ist die warme Witterung der vergangenen Wochen. Erste Betriebe starten schon in der kommenden Woche.",
    },
    {
      region: "Welt",
      headline: "Die großen Notenbanken lassen die Leitzinsen unverändert",
      body: "Begründet wird das mit einer langsam sinkenden Inflation. Anpassungen sind frühestens im Herbst zu erwarten.",
    },
  ];
}

/** Anmoderation der Nachrichten inkl. Themenüberblick. */
function newsIntroText(host: Host, at: number, stories: Story[], mode: "full" | "short") {
  const themes = stories
    .slice(0, mode === "full" ? 4 : 3)
    .map((s) => endWithDot(s.headline))
    .join(" ");
  const label = mode === "full" ? "Die Nachrichten" : "Die Kurznachrichten";
  return `Es ist ${spokenTime(at)}. ${label} auf Welle Südwest mit ${host.name}. Heute mit diesen Themen: ${themes}`;
}

/** Ausführlicher Nachrichtenblock. */
function newsBodyText(host: Host, stories: Story[], mode: "full" | "short", at: number) {
  const list = stories.slice(0, mode === "full" ? 8 : 10);
  const parts = list.map((s, i) => {
    const lead = regionLead(s.region, i);
    const head = endWithDot(s.headline);
    if (mode === "short") return `${lead ? `${lead}: ` : ""}${head}`;
    const body = s.body ? ` ${endWithDot(s.body)}` : "";
    const author = s.author ? ` Ein Bericht von ${s.author}.` : "";
    const extra = i > 0 && i % 3 === 0 ? ` ${pick(CORRESPONDENT, i + at)}` : "";
    const connect = i === 0 ? "" : `${pick(CONNECT, i + at)} `;
    return `${connect}${lead ? `${lead}: ` : ""}${head}${body}${author}${extra}`;
  });
  const outro =
    mode === "full"
      ? `Das waren die Nachrichten von Welle Südwest. Am Mikrofon ${host.name}. Die nächsten Nachrichten hören Sie zur halben Stunde. Und jetzt der Verkehr.`
      : `Mehr Nachrichten zur vollen Stunde. Am Mikrofon ${host.name}. Jetzt der Verkehr.`;
  return `${parts.join(" ")} ${outro}`;
}

/* ------------------------------------------------------------------- Verkehr */

const URGENT =
  /(unfall|vollsperrung|gesperrt|sperrung|gefahr|geisterfahrer|gegenst|personen auf der fahrbahn|bergung|glätte|sturm|rettungsgasse|lkw)/i;
/** Nur echte Sofort-Lagen unterbrechen das Programm. */
const SPONTAN =
  /(unfall|vollsperrung|geisterfahrer|falschfahrer|personen auf der fahrbahn|brand|feuer|feuerwehreinsatz|evakuier|gefahrgut|gefahrstoff|explosion|bergung)/i;
const RELEVANT =
  /(stau|stockend|zäh|behinderung|verzöger|baustelle|verengung|unfall|stillstand|reisezeitverlust|gesperrt|sperrung)/i;

function reasonOf(text: string) {
  const t = text.toLowerCase();
  if (t.includes("unfall")) return "nach einem Unfall";
  if (t.includes("bergung")) return "wegen Bergungsarbeiten";
  if (t.includes("baustelle") || t.includes("bauarbeiten")) return "wegen einer Baustelle";
  if (t.includes("verengung")) return "wegen einer Fahrbahnverengung";
  if (t.includes("gegenst")) return "wegen Gegenständen auf der Fahrbahn";
  if (t.includes("geisterfahrer")) return "wegen eines Falschfahrers";
  if (t.includes("sperrung") || t.includes("gesperrt")) return "wegen einer Sperrung";
  if (t.includes("glätte")) return "wegen Glätte";
  if (t.includes("berufsverkehr")) return "im Berufsverkehr";
  return "";
}

/** Km-Angabe aus dem Meldungstext ziehen, sonst realistisch schätzen. */
function kmOf(text: string, seed: number) {
  // Entfernungsmarken wie „0.3 km hinter AS X" sind keine Staulänge.
  const all = [
    ...text.matchAll(
      /(\d+(?:[.,]\d+)?)\s*(?:km|kilometer)\b(?!\/h)(?!\s*(?:hinter|vor|nach|bis|entfernt))/gi,
    ),
  ]
    .map((m) => Number(m[1].replace(",", ".")))
    .filter((n) => n >= 1);
  if (all.length) return Math.max(1, Math.round(Math.max(...all)));
  return 2 + (seed % 6);
}

/** Zeitverlust direkt aus dem Feed, sonst aus der Staulänge geschätzt. */
function minutesOf(text: string, km: number) {
  const m = text.match(/Reisezeitverlust:?\s*(\d+)\s*Minute/i);
  if (m) return Math.max(2, Number(m[1]));
  return Math.max(5, Math.round(km * 2.5));
}

const kmWord = (km: number) => (km === 1 ? "rund einen Kilometer" : `rund ${km} Kilometer`);
const minWord = (min: number) => (min === 1 ? "eine Minute" : `${min} Minuten`);

function betweenOf(text: string) {
  /** „AS Homburg" → „Ausfahrt Homburg", damit die Stelle klar ausgesprochen wird. */
  const label = (raw: string) => {
    const v = clean(raw).replace(/^(der|dem|die)\s+/i, "");
    if (
      /^(Anschlussstelle|Ausfahrt|Auffahrt|Kreuz|Autobahnkreuz|Dreieck|Autobahndreieck|Raststätte|Rastanlage|Tunnel|Brücke|Kilometer)/i.test(
        v,
      )
    ) {
      return v
        .replace(/^Anschlussstelle/i, "Ausfahrt")
        .replace(/^Kreuz/i, "Autobahnkreuz")
        .replace(/^Dreieck/i, "Autobahndreieck");
    }
    return `Ausfahrt ${v}`;
  };
  const m = text.match(
    /zwischen\s+(?:(?:\d+(?:[.,]\d+)?)\s*km\s+)?(?:hinter|nach)?\s*(?:der\s+|dem\s+)?((?:AS|ASt\.?|Anschlussstelle|Ausfahrt|AK|AD|Kreuz|Dreieck|Raststätte|Rastanlage|Auffahrt)?\s*[^,.;]{2,45}?)\s+und\s+(?:(?:\d+(?:[.,]\d+)?)\s*km\s+)?(?:vor|bis)?\s*(?:der\s+|dem\s+)?((?:AS|ASt\.?|Anschlussstelle|Ausfahrt|AK|AD|Kreuz|Dreieck|Raststätte|Rastanlage|Auffahrt)?\s*[^,.;]{2,45})/i,
  );
  if (m) return `zwischen ${label(m[1])} und ${label(m[2])}`;
  const titled = text.match(
    /\bA\d{1,3}\s*\|\s*([A-ZÄÖÜ][^|,.;]{2,45}?)\s+-\s+([A-ZÄÖÜ][^|,.;]{2,45}?)(?:\s+Beginn|\s*$)/i,
  );
  if (titled) return `zwischen ${label(titled[1])} und ${label(titled[2])}`;
  const a = text.match(
    /(?:AS|ASt\.?|Anschlussstelle|Ausfahrt|AK|AD|Kreuz|Dreieck|Raststätte|Rastanlage|Tunnel|Brücke)\s+[A-ZÄÖÜ][\wäöüß./-]*(?:[- ][A-ZÄÖÜ][\wäöüß./-]*)?/,
  );
  if (a) return `an der ${label(a[0])}`;
  const h = text.match(
    /(?:in\s+)?Höhe\s+(?:von\s+)?([A-ZÄÖÜ][\wäöüß.-]+(?:[- ][A-ZÄÖÜ][\wäöüß.-]+)?)/,
  );
  if (h) return `in Höhe ${clean(h[1])}`;
  const b = text.match(/\bbei\s+([A-ZÄÖÜ][\wäöüß.-]+(?:[- ][A-ZÄÖÜ][\wäöüß.-]+)?)/);
  if (b) return `bei ${clean(b[1])}`;
  const km = text.match(/km\s*(\d+(?:[.,]\d+)?)/i);
  return km ? `bei Kilometer ${km[1].replace(".", ",")}` : "";
}

/** Bauzeit-Ende aus dem Meldungstext lesen ("bis 12.08.2026", "bis Ende Oktober"). */
function untilOf(text: string) {
  const d = text.match(/bis\s+(?:zum\s+)?(\d{1,2}\.\s?\d{1,2}\.(?:\s?\d{2,4})?)/i);
  if (d) return `noch bis zum ${clean(d[1])}`;
  const m = text.match(
    /bis\s+(Anfang|Mitte|Ende)\s+(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)/i,
  );
  if (m) return `noch bis ${clean(m[0]).replace(/^bis\s+/i, "")}`;
  return "";
}

function directionOf(text: string) {
  const m = text.match(/Richtung\s+([A-ZÄÖÜ][\wäöüß-]+)/);
  return m ? `in Richtung ${m[1]}` : "";
}

/** Eine natürlich klingende Verkehrsmeldung im Radiostil. */
function trafficLine(
  item: { road: string; headline: string; message: string },
  index: number,
): string {
  const original = cleanTraffic(`${item.headline} ${item.message}`);
  const raw = original
    // Abkürzungen ausschreiben, sonst sagt die Stimme „A S" statt „Ausfahrt".
    .replace(/\bAS\s+/g, "Ausfahrt ")
    .replace(/\bAK\s+/g, "Autobahnkreuz ")
    .replace(/\bAD\s+/g, "Autobahndreieck ")
    .replace(/\bASt\.?\s+/g, "Ausfahrt ")
    .replace(/\bRi\.\s*/g, "Richtung ");
  const road = item.road?.trim() || "";
  // Exakter Abschnitt aus der Ausfahrtstabelle, sonst Textanalyse.
  const where = exactSection(road, original) || exactSection(road, raw) || betweenOf(raw);
  const dir = directionOf(raw);
  const reason = reasonOf(raw);
  const urgent = URGENT.test(raw);
  const km = kmOf(raw, index + road.length);
  const minutes = minutesOf(raw, km);
  const place = clean(`${dir} ${where}`) || "im Streckenverlauf";

  if (/vollsperr|gesperrt/i.test(raw)) {
    return clean(
      `${road ? `Auf der ${road}` : "Achtung"} ${place} ist die Strecke ${reason} gesperrt. Bitte weiträumig umfahren.`,
    );
  }

  if (/baustelle|bauarbeiten|verengung/i.test(raw)) {
    const until = untilOf(raw);
    const art = /stockend|zäh/i.test(raw) ? "stockender Verkehr" : "Stau";
    return clean(
      `${road ? `Auf der ${road}` : "Achtung"} ${place} ist wegen einer Baustelle nur eingeschränkt Platz. Dort steht der Verkehr auf ${kmWord(km)}, es gibt ${art}. Die Baustelle bleibt voraussichtlich ${
        until || "noch einige Wochen"
      } bestehen. Planen Sie dort etwa ${minWord(minutes)} mehr ein.`,
    );
  }

  const stillstand = /stillstand/i.test(raw);
  const art = stillstand
    ? `geht auf ${kmWord(km)} im Moment gar nichts`
    : /stockend|zäh/i.test(raw)
      ? `geht es auf ${kmWord(km)} nur stockend voran`
      : `steht der Verkehr auf ${kmWord(km)}`;
  const opener = pick(
    [
      `${road ? `Auf der ${road}` : "Achtung"} ${place}`,
      `${road ? `${road}, ` : ""}${place} – dort`,
      `Nächster Punkt: ${road ? `auf der ${road}` : "in der Region"} ${place}`,
      `${road ? `Die ${road}` : "Achtung"} ${place}`,
    ],
    index,
  );
  const tail = pick(
    [
      `Planen Sie hier etwa ${minWord(minutes)} mehr ein.`,
      `Das kostet Sie im Moment rund ${minWord(minutes)}.`,
      `Rechnen Sie mit ${minWord(minutes)} zusätzlich.`,
      `Wer da durch muss, braucht etwa ${minWord(minutes)} länger.`,
    ],
    index + km,
  );
  return clean(
    `${opener} ${art}${reason ? ` ${reason}` : ""}. ${tail}${
      urgent ? " Bitte bilden Sie eine Rettungsgasse." : ""
    }`,
  );
}

/**
 * Ein gemeinsamer Verkehrsblock für Saarland und Rheinland-Pfalz –
 * nur wirklich relevante Meldungen, mit Grund und Zeitverlust.
 */
export function trafficText(ctx: PlanContext, at: number) {
  const relevant = ctx.traffic
    .filter((t) => {
      const s = `${t.headline} ${t.message}`;
      return URGENT.test(s) || RELEVANT.test(s);
    })
    .sort((a, b) => {
      const ua = URGENT.test(`${a.headline} ${a.message}`) ? 0 : 1;
      const ub = URGENT.test(`${b.headline} ${b.message}`) ? 0 : 1;
      return ua - ub;
    })
    .slice(0, 5);

  const lines = relevant.map((t, i) => trafficLine(t, i));
  const body = lines.length
    ? lines.join(" ")
    : "Auf den Autobahnen im Saarland und in Rheinland-Pfalz läuft der Verkehr zur Zeit störungsfrei. Keine größeren Behinderungen gemeldet.";
  const seed = berlinMinute(at) + relevant.length;
  const intro = pick(
    [
      `${spokenTime(at)}, der Verkehr für das Saarland und Rheinland-Pfalz.`,
      `Jetzt der Blick auf die Straßen zwischen Saar, Mosel und Rhein.`,
      `${spokenTime(at)} – wie läuft es gerade auf unseren Autobahnen?`,
      `Der Verkehrsservice auf Welle Südwest, ${spokenTime(at)}.`,
    ],
    seed,
  );
  const outro = pick(
    [
      "Melden Sie uns Staus, Gefahren und Blitzer über unsere Hörer-Hotline. Fahren Sie umsichtig.",
      "Kommen Sie gut durch – und danke an alle, die uns über die Hotline melden, was los ist.",
      "Wir halten Sie auf dem Laufenden, sobald sich etwas ändert. Gute Fahrt.",
    ],
    seed + 1,
  );
  return clean(`${intro} ${body} ${listenerLines(ctx)} ${outro}`);
}

/** Frische Live-Meldungen aus der Hörer-Hotline (max. 6 Stunden alt). */
function freshHotline(ctx: PlanContext) {
  const now = Date.now();
  return (ctx.hotline ?? []).filter((h) => now - h.createdAt < 6 * 3600_000);
}

/** Verkehrs-Hörermeldungen im Sprechtext. */
function listenerLines(ctx: PlanContext) {
  const list = freshHotline(ctx)
    .filter((h) => h.type === "verkehr")
    .slice(0, 3);
  if (!list.length) return "";
  const lines = list.map((h) =>
    clean(
      `${h.road ? `Auf der ${h.road} ` : ""}${h.place ? `bei ${h.place}` : "in der Region"}: ${endWithDot(h.message)}`,
    ),
  );
  return `Und das haben uns Hörerinnen und Hörer gerade gemeldet. ${lines.join(" ")}`;
}

/** Wetter-Hörermeldungen (1-2) für den Wetterblock – passend zum Thema, nicht generisch verstreut. */
function weatherListenerLine(ctx: PlanContext) {
  const list = freshHotline(ctx)
    .filter((h) => h.type === "wetter")
    .slice(0, 2);
  if (!list.length) return "";
  const lines = list.map((h) =>
    clean(`${h.place ? `aus ${h.place}` : "aus der Region"}: ${endWithDot(h.message)}`),
  );
  return ` Dazu Meldungen von Hörerinnen und Hörern, ${lines.join(", ")}`;
}

/** Blitzer-Service – ausschließlich aus Hörermeldungen. */
export function blitzerLine(ctx: PlanContext) {
  const list = freshHotline(ctx)
    .filter((h) => h.type === "blitzer")
    .slice(0, 5);
  if (!list.length) return "";
  const lines = list.map((h) =>
    clean(
      `${h.region === "Saarland" ? "Im Saarland" : "In Rheinland-Pfalz"}: ${
        h.road ? `${h.road}, ` : ""
      }${h.place}${h.message ? `, ${h.message.replace(/[.!?]+$/, "")}` : ""}`,
    ),
  );
  return `Und jetzt der Blitzer-Service für Saarland und Rheinland-Pfalz. Geblitzt wird gemeldet: ${lines.join(
    ". ",
  )}. Alle Angaben ohne Gewähr, halten Sie sich bitte an das Tempolimit.`;
}

/** Anzahl frischer Blitzer-Meldungen – steuert den eigenen Blitzer-Block im Plan. */
export function blitzerCount(ctx: PlanContext) {
  return freshHotline(ctx).filter((h) => h.type === "blitzer").length;
}

/** Wichtige Meldungen (Unfälle, Sperrungen, Gefahren) – nur wenn es wirklich etwas gibt. */
export function urgentText(ctx: PlanContext) {
  const spontan = ctx.traffic.filter((t) => {
    const s = `${t.headline} ${t.message}`;
    return SPONTAN.test(s) && !/baustelle|bauarbeiten|verengung/i.test(s);
  });
  const callers = freshHotline(ctx).filter(
    (h) => h.type === "verkehr" && SPONTAN.test(`${h.place} ${h.message}`),
  );
  if (!spontan.length && !callers.length) return null;
  const lines = spontan.slice(0, 2).map((t, i) => {
    const raw = clean(`${t.headline} ${t.message}`);
    if (/brand|feuer|evakuier|gefahrgut|gefahrstoff|explosion/i.test(raw)) {
      const place = clean(`${betweenOf(raw)}`) || (t.road ? `an der ${t.road}` : "in der Region");
      return clean(
        `Größerer Einsatz der Feuerwehr ${place}. Anwohnerinnen und Anwohner werden gebeten, Fenster und Türen geschlossen zu halten und den Bereich zu meiden.`,
      );
    }
    return trafficLine(t, i);
  });
  const callerLines = callers
    .slice(0, 2)
    .map((h) =>
      clean(
        `Von einer Hörermeldung: ${h.road ? `Auf der ${h.road} ` : ""}${
          h.place ? `bei ${h.place}` : "in der Region"
        } ${endWithDot(h.message)}`,
      ),
    );
  return `Eine wichtige Meldung für die Region. ${[...lines, ...callerLines].join(" ")} Bitte fahren Sie besonders vorsichtig.`;
}

/* -------------------------------------------------------------------- Wetter */

const SEASON_TEMP = [4, 5, 9, 14, 19, 23, 25, 25, 20, 14, 8, 5];

function weatherText(host: Host, at: number, outlook: boolean, ctx?: PlanContext) {
  const hour = berlinHour(at);
  const date = berlinDate(at);
  const base = SEASON_TEMP[berlinMonth(at)];
  const high = base + (date % 4) - 1;
  const low = Math.max(-6, high - 7);
  const sky = pick(
    [
      "wechselnd bewölkt mit längeren freundlichen Abschnitten",
      "zunächst dicht bewölkt, im Tagesverlauf lockert es auf",
      "meist freundlich, nur wenige Wolkenfelder",
      "stark bewölkt und zeitweise etwas Regen",
    ],
    date + hour,
  );
  const wind = pick(
    ["schwacher Wind aus Südwest", "mäßiger Wind aus West, in Böen frisch", "kaum Wind"],
    date,
  );
  const teil =
    hour < 11
      ? "am Vormittag"
      : hour < 17
        ? "am Nachmittag"
        : hour < 22
          ? "am Abend"
          : "in der Nacht";
  const sponsor = sponsorFor("wetter");
  // Echter Zwei-/Dreitagesausblick statt immer nur "morgen bleibt es ähnlich" – mit leichter
  // Schwankung pro Tag, damit sich die Werte über die Woche nicht alle gleich anhören.
  const outlookText = outlook
    ? (() => {
        const day2 = high + (((date + 1) % 5) - 2);
        const day3 = high + (((date + 2) % 5) - 2);
        const trend = pick(
          [
            `Morgen wird es mit rund ${day2} Grad ähnlich, übermorgen dann ${day3 > day2 ? "etwas wärmer" : "etwas kühler"} bei ${day3} Grad.`,
            `Der Blick auf die nächsten Tage: morgen ${day2} Grad, ${trendWord(day2, day3)} geht es übermorgen Richtung ${day3} Grad.`,
            `Für die nächsten beiden Tage zeichnet sich ${day2 >= high ? "weiter freundliches" : "etwas wechselhafteres"} Wetter ab, mit Höchstwerten um ${day2} und ${day3} Grad.`,
          ],
          date,
        );
        return ` ${trend}`;
      })()
    : " Morgen bleibt es bei ähnlichen Werten.";
  const listenerLine = ctx ? weatherListenerLine(ctx) : "";
  return clean(
    `${sponsor ? `Das Wetter auf Welle Südwest, präsentiert von ${sponsor.name}. ` : "Das Wetter auf Welle Südwest. "}Im Saarland und in Rheinland-Pfalz ${teil} ${sky}. Die Höchstwerte liegen bei ${high} Grad, im Saartal bis ${high + 1} Grad, in den Höhenlagen von Hunsrück, Eifel und Pfälzerwald nur um ${high - 3} Grad. Dazu ${wind}. In der Nacht kühlt es auf ${low} Grad ab.${outlookText}${listenerLine} ${host.name} wünscht Ihnen einen guten Verlauf.`,
  );
}

function trendWord(a: number, b: number) {
  return b > a ? "aufwärts" : b < a ? "abwärts" : "seitwärts";
}

/** Kurze Übergabe der Moderation an eine Wetter-Expert:in – nur die Anmoderation, das eigentliche
 *  Wetter spricht dann die Expert:in selbst (siehe pushWeather). */
function weatherHandoffText(host: Host, expert: Host, at: number) {
  return pick(
    [
      `Und jetzt wie immer zum Wetter – dafür ist heute wieder ${expert.name} bei uns. ${expert.name}, wie sieht's aus?`,
      `Zeit fürs Wetter, und das übernimmt ${expert.name}. Ich bin gespannt.`,
      `${expert.name} ist wieder mit am Start fürs Wetter. Lass hören.`,
    ],
    berlinMinute(at),
  );
}

/** Kurze Übergabe der Moderation an eine Korrespondent:in in einer anderen Stadt. */
function correspondentHandoffText(correspondent: Correspondent, at: number) {
  return pick(
    [
      `Und jetzt schalten wir zu ${correspondent.name} in ${correspondent.city}. ${correspondent.name}, was gibt's Neues bei Ihnen?`,
      `Zeit für unseren Blick nach ${correspondent.city} – ${correspondent.name} ist zugeschaltet.`,
      `Wir bleiben nicht nur hier in der Region: ${correspondent.name} meldet sich aus ${correspondent.city}.`,
    ],
    berlinMinute(at),
  );
}

/** Vollständige Fallback-Berichte je Korrespondent:in (falls die KI-Umformulierung mal ausfällt,
 *  muss der Text auch unverändert vorlesbar sein) – dienen der KI sonst nur als Stil-Vorlage,
 *  die eigentlichen Inhalte erfindet sie pro Durchlauf neu (siehe tryHumanizeModeration). */
const CORRESPONDENT_REPORTS: Record<string, string[]> = {
  co1: [
    "Hier in Berlin wird gerade wieder viel über die nächste Kabinettssitzung diskutiert, vor allem am Regierungsviertel ist die Stimmung angespannt. Für die Region heißt das vor allem: abwarten, was am Ende wirklich beschlossen wird.",
    "In Berlin ist es heute ungewöhnlich ruhig für einen Wochentag, die großen Termine liegen erst später in der Woche. Trotzdem laufen im Hintergrund schon die Vorbereitungen für die nächste Pressekonferenz.",
  ],
  co2: [
    "Hier in New York ist gerade wieder viel Bewegung an den Märkten, viele hier reden über die neuesten Zahlen aus der Techbranche. Für Verbraucher bei uns kann sich das mittelfristig auch beim Energiepreis bemerkbar machen.",
    "In den USA wird gerade intensiv über die nächste Zinsentscheidung spekuliert. Hier vor Ort merkt man die Unsicherheit schon an den Gesichtern der Händler.",
  ],
  co3: [
    "Aus Mainz gibt es Neuigkeiten vom Landtag: dort wird gerade über ein neues Förderprogramm für den ländlichen Raum beraten, das auch bei uns in der Region ankommen könnte.",
    "Hier in Mainz laufen die Vorbereitungen für die nächste Plenarsitzung, einige Abgeordnete aus unserer Region sind auch dabei.",
  ],
  co4: [
    "Aus Saarbrücken gibt es ein kleines Update: die Innenstadt füllt sich gerade wieder, mehrere neue Geschäfte haben in den letzten Wochen eröffnet.",
    "Hier in Saarbrücken wird aktuell über die nächsten Schritte bei der Stadtentwicklung diskutiert, viele Anwohner bringen sich gerade aktiv ein.",
  ],
  co5: [
    "Aus Brüssel gibt es Bewegung bei einem neuen Vorhaben, das auch grenznahe Regionen wie unsere betreffen könnte – Details werden aber erst in den kommenden Wochen erwartet.",
    "Hier in Brüssel ist gerade viel Betrieb rund um die nächste Ratssitzung, die Delegationen treffen schon ein.",
  ],
};

/** Kurze, themenunabhängige Reaktionen der zweiten Stimme in einer 2er-Show – funktionieren
 *  unabhängig vom gerade behandelten Thema, damit auch der Fallback (falls die KI-Umformulierung
 *  scheitert) immer sinnvoll klingt. */
const COHOST_REACTIONS = [
  "Da musste ich echt schmunzeln, gute Story.",
  "Ehrlich gesagt kann ich das absolut nachvollziehen.",
  "Das sehe ich ganz genauso, und es passt auch gut zu heute.",
  "Schöne Geschichte, die hätte ich so nicht erwartet.",
  "Da bin ich ganz bei dir, das kenne ich auch.",
  "Stimmt, das ist mir letztens auch aufgefallen.",
];

/* ---------------------------------------------------------------- Moderation */

// Bewusst zeitlos gehalten (kein "Feierabend"/"heute früh" o. Ä.) – läuft zu jeder Tages- und
// Nachtzeit und darf nie falsch klingen, nur weil die Uhrzeit gerade nicht passt.
const SMALLTALK = [
  "Kleiner Fun-Fact am Rande: Wer im Stau steht, hat statistisch die beste Zeit zum Mitsingen.",
  "In der Redaktion diskutieren wir gerade, ob Lyoner aufs Brot gehört oder in die Pfanne. Schreiben Sie uns gern.",
  "Unser Praktikant behauptet, er kenne eine Abkürzung. Wir glauben ihm kein Wort.",
  "Wussten Sie das? Zwischen Saar und Rhein gibt es mehr Weinlagen als Regentage im Juli. Zumindest fühlt es sich so an.",
  "Kleiner Tipp aus der Redaktion: Das Fenster einmal kurz aufmachen wirkt Wunder.",
  "Kleine Randnotiz aus dem Studio: Es gibt hier eine hitzige Debatte, ob der Kaffee stärker schmeckt als anderswo. Wir sagen: ja.",
  "Ein Gedanke für zwischendurch: Die besten Ideen kommen angeblich unter der Dusche. Das würde einiges erklären.",
  "Kleines Geständnis aus der Redaktion: Wir verwechseln immer noch regelmäßig links und rechts vom Mikro. Zum Glück hört man das nicht.",
  "Fun Fact: Wer diesen Satz laut mitliest, hat gerade offiziell mit uns moderiert. Willkommen im Team.",
];

/* ------------------------------------------------- Themen-Checkliste */

export type TopicCat =
  "kultur" | "netz" | "witziges" | "service" | "region" | "musik" | "hoerer" | "nacht";

/** Diese vier Rubriken müssen tagsüber in jeder Moderationsrunde vorkommen. */
const CHECKLIST: TopicCat[] = ["kultur", "netz", "witziges", "service"];
/** Nachts (0–5 Uhr) andere Prioritäten: ruhig, persönlich, aufmunternd statt Themen-Pflichtprogramm. */
const NIGHT_CHECKLIST: TopicCat[] = ["nacht", "hoerer"];

const CAT_PATTERNS: Record<TopicCat, RegExp> = {
  kultur: /kultur|termin|konzert|bühne|ausstellung|wochenendtipp/i,
  netz: /netz|online|social|trend|internet/i,
  witziges: /witzig|kurios|anekdote|fun|schmunzel/i,
  service: /service|verbrauch|tipp|geld|wetter & weg|weg zur arbeit|verkehr & feierabend/i,
  region: /region|saar|pfalz|gespräch|heute wichtig|rückblick|mittagsthema/i,
  musik: /musik|song|charts|special/i,
  hoerer: /hörer|frage|grüße|post/i,
  nacht: /nacht|schlaflos|wach|einsam|ruhe/i,
};

/** Ersatzthemen, falls eine Rubrik im Sendungsraster fehlt. */
const CAT_TOPICS: Record<TopicCat, string[]> = {
  kultur: ["Kultur & Termine", "Bühne in der Region", "Kulturtipp des Tages"],
  netz: ["Trends aus dem Netz", "Digital-Thema", "Netzfundstück"],
  witziges: ["Witziges aus dem Netz", "Kurioses aus der Region", "Schmunzelgeschichte"],
  service: ["Servicethema", "Verbrauchertipps", "Alltagshilfe"],
  region: ["Region im Gespräch", "Thema aus dem Saarland"],
  musik: ["Musikgeschichten", "Song des Tages"],
  hoerer: ["Hörerfrage des Tages", "Ihre Nachrichten an uns"],
  nacht: ["Nachtgedanken", "Gruß in die Nacht", "Für alle, die jetzt wach sind"],
};

/**
 * Vollständige Inhalte – jede Zeile erzählt die Sache zu Ende,
 * keine leeren Ankündigungen ("dazu gleich mehr") ohne Auflösung.
 */
const CAT_TALK: Record<TopicCat, string[]> = {
  kultur: [
    "In Saarbrücken läuft ab dieser Woche die neue Ausstellung in der Modernen Galerie, Eintritt sieben Euro, donnerstags abends sogar frei – und in Mainz spielt die Kammerphilharmonie am Samstag im Frankfurter Hof, Restkarten gibt es an der Abendkasse.",
    "Kultur bei uns heißt kleine Bühne, großer Abend: In Kaiserslautern gibt es diese Woche Kabarett für zwölf Euro, in Trier eine Lesung mit Autorinnen aus der Region, und in Neunkirchen spielt die Stadtkapelle open air – alles ohne Voranmeldung.",
    "Wer heute Abend noch nichts vorhat: Die Kinos in der Region zeigen wieder die Originalfassungen, in Saarlouis läuft dazu eine Fotoausstellung über die alten Hüttenwerke. Beides kostet zusammen weniger als ein Pizzaabend.",
    "Ein Geheimtipp aus Zweibrücken: Das kleine Theater am Rathaus zeigt freitags Impro-Comedy, Karten meist noch an der Abendkasse. In Landau läuft parallel ein Straßenmusik-Festival, komplett kostenlos.",
    "In Homburg öffnet diese Woche die neue Genussmeile in der Altstadt, mit Ständen von Betrieben aus der ganzen Region. Und in Worms gibt es dazu passend eine Nacht der offenen Ateliers.",
  ],
  netz: [
    "Im Netz diskutieren gerade alle über die neuen Kurzvideo-Rezepte – drei Zutaten, fünf Minuten. Wir haben eins in der Redaktion getestet, es hat funktioniert, sah aber deutlich weniger hübsch aus als im Video.",
    "Ein Trend, der auch bei uns ankommt: Menschen zeigen online ihren Arbeitsweg im Zeitraffer. Aus Homburg nach Saarbrücken sieht das erstaunlich entspannt aus – in echt kennen wir das anders.",
    "Online geht gerade eine Karte rum, auf der jeder seinen liebsten Bäcker markiert. Das Saarland ist darauf schon ziemlich voll, Rheinland-Pfalz hat noch Lücken – tragen Sie sich ruhig ein.",
    "Gerade beliebt im Netz: Leute filmen, wie ihre Haustiere auf Donner reagieren. Ein Kater aus Kaiserslautern hat es damit auf über eine Million Aufrufe geschafft, indem er einfach weitergeschlafen hat.",
    "Ein Account aus der Region sammelt gerade alte Schulhof-Sprüche aus den Neunzigern – die Kommentare darunter sind fast besser als die Sprüche selbst.",
  ],
  witziges: [
    "Und dann das: Ein Hund in Zweibrücken hat gelernt, die Türklingel zu bedienen. Er hat es gestern siebenmal gemacht, immer wenn er Hunger hatte. Die Nachbarn waren mäßig begeistert, die Familie hat die Klingel jetzt abgeklebt.",
    "Kurios: Jemand hat seinen Einkaufszettel vertont und daraus einen Song gemacht. Der läuft im Netz besser als manche Single – der Refrain besteht komplett aus Milch, Butter, Brot.",
    "In Mainz hat ein Mann seinen Wagen zwei Tage lang gesucht – er stand die ganze Zeit in der richtigen Straße, nur ein Parkdeck höher. Er sagt, er nimmt jetzt wieder die Bahn.",
    "Aus Kaiserslautern: Ein Bäcker hat aus Versehen dreihundert Brötchen zu viel gebacken. Statt sie wegzuwerfen, hat er sie vor die Tür gestellt – nach vierzig Minuten war der Korb leer und die Kasse voller Spenden fürs Tierheim.",
    "In Trier wollte jemand sein Fahrrad per Kleinanzeige verkaufen und hat aus Versehen das Foto vom Wohnzimmer hochgeladen. Es gab elf Anfragen – für die Couch.",
    "Ein Paar aus Neunkirchen hat sich beim Discounter kennengelernt, weil beide nach der letzten Packung Fleischwurst gegriffen haben. Geheiratet wird im Mai, das Motto steht schon fest.",
    "Kurios aus Ludwigshafen: Ein Papagei hat den Klingelton seines Besitzers so gut nachgemacht, dass der Mann drei Tage lang nach seinem Handy gesucht hat. Es lag die ganze Zeit im Kühlschrank.",
    "Und noch eine schöne Geschichte: In Saarlouis hat eine Schulklasse ihren verlorenen Klassenhamster über einen Zettel im Treppenhaus wiedergefunden. Er saß beim Nachbarn auf dem Sofa und hat ferngesehen.",
    "Aus Koblenz gemeldet: Ein Mann hat sein Auto rückwärts gewaschen – also erst poliert, dann geschäumt. Er sagt, das Ergebnis sei überraschend in Ordnung. Wir bleiben skeptisch.",
    "Und dann das: Ein Postbote in der Pfalz bekommt seit Jahren an jeder Haustür Kekse. Er hat jetzt öffentlich um Obst gebeten. Die Straße hat geliefert – mit vier Kisten Äpfeln.",
  ],
  service: [
    "Ein Servicethema, das viele betrifft: Wer jetzt seinen Stromvertrag prüft, spart im Jahr oft dreistellig. Wichtig ist die Kündigungsfrist im Vertrag, meist sechs Wochen zum Monatsende – ein Blick ins Portal reicht schon.",
    "Praktisch für den Alltag: Wer Termine bei der Zulassungsstelle braucht, bekommt online meist innerhalb einer Woche einen Platz, vor Ort dauert es deutlich länger. Personalausweis und Versicherungsnummer vorher bereitlegen, dann sind Sie in zehn Minuten durch.",
    "Kleiner Geldtipp: Die Rückerstattung bei verspäteten Zügen gilt ab sechzig Minuten mit einem Viertel des Fahrpreises. Das Formular gibt es online, Sie brauchen nur das Ticket und die Zugnummer.",
    "Praktisch, falls Sie es noch nicht wussten: Rezepte lassen sich inzwischen bei den meisten Kassen direkt aufs Handy schicken lassen, die App braucht nur einmalig die Versichertennummer.",
    "Ein Tipp für alle, die gerade umziehen: Der Nachsendeauftrag der Post lohnt sich für sechs Monate, danach ist ein neuer meist günstiger als die Verlängerung.",
  ],
  region: [
    "Bei uns in der Region tut sich einiges: In mehreren Gemeinden im Saarpfalz-Kreis werden gerade die Ortsdurchfahrten saniert. Das dauert bis in den Herbst, dafür sind die Strecken danach deutlich ruhiger.",
    "Wir haben mit Leuten aus Trier und Saarbrücken gesprochen, was ihnen im Alltag am meisten fehlt. Antwort Nummer eins: verlässliche Busverbindungen am Abend.",
    "Aus der Region gemeldet: Mehrere Gemeinden zwischen Saar und Mosel bauen gerade ihr Radwegenetz aus, einige Abschnitte sind jetzt schon freigegeben und deutlich breiter als vorher.",
    "Ein kleines Update aus Rheinland-Pfalz: Der Wochenmarkt in Bad Kreuznach bekommt einen zweiten Tag pro Woche, weil die Nachfrage einfach da ist.",
  ],
  musik: [
    "Zum Song vorhin noch eine Geschichte: Die Band hat das Demo in einer Garage aufgenommen, weil das Studio ausgebucht war – man hört im Hintergrund tatsächlich ein Garagentor.",
    "Der Titel, den Sie gerade gehört haben, war ursprünglich als Ballade geplant. Erst der Schlagzeuger hat daraus das Tempo gemacht, das jetzt jeder mitklatscht.",
    "Kleine Anekdote zum letzten Song: Der Text ist angeblich auf einer Zugfahrt entstanden, komplett auf die Rückseite einer Fahrkarte gekritzelt.",
    "Was viele nicht wissen: Der Refrain von vorhin wurde ursprünglich für eine ganz andere Band geschrieben – die hat dankend abgelehnt, zum Glück für uns alle.",
  ],
  hoerer: [
    "Ihre Nachrichten erreichen uns weiter: Frau Bauer aus Idar-Oberstein grüßt ihre Frühschicht, und Tim aus Völklingen wünscht sich mehr Musik zum Lernen. Beides machen wir.",
    "Sie haben uns geschrieben, wo die schönste Runde zum Kopf-frei-Kriegen ist. Klarer Favorit: der Weg am Saarufer entlang, dicht gefolgt vom Deutschherrenufer in Trier.",
    "Ein Hörer aus Merzig hat uns geschrieben, dass er seit Jahren jeden Song hier mitsingt, auch wenn er den Text falsch versteht. Ehrlich gesagt: geht uns manchmal genauso.",
    "Danke für die vielen Nachrichten heute – wir lesen wirklich jede, auch wenn nicht jede auf Sendung geht. Machen Sie weiter so.",
  ],
  nacht: [
    "Ein Gruß an alle, die jetzt noch wach sind – ob im Krankenhaus, am Fließband oder einfach, weil der Schlaf nicht kommen will: Schön, dass Sie uns gerade zuhören.",
    "Die Nacht gehört denen, die sonst selten eine Bühne bekommen: der Frühschicht, die sich gerade fertig macht, und allen, die jetzt noch durcharbeiten. Weiter so, wir sind bei Ihnen.",
    "Wenn um diese Uhrzeit noch Licht brennt, hat das meistens einen guten Grund. Was auch immer Sie wach hält – wir leisten gern Gesellschaft.",
    "Ein kleiner Gedanke für die Nacht: Morgen sieht vieles schon wieder anders aus. Bis dahin einfach durchatmen und die Musik laufen lassen.",
    "An alle im Nachtdienst da draußen: Danke, dass Sie da sind, wenn andere schlafen. Diese Stunde ist für Sie.",
    "Falls der Kopf nachts nicht abschalten will: Sie sind damit nicht allein, hier hören gerade eine Menge Leute in derselben Lage mit. Wir bleiben einfach zusammen wach.",
    "Ein bisschen Mut für alle, die morgen früh raus müssen und jetzt noch nicht schlafen können: Es reicht auch weniger Schlaf als gedacht. Wir begleiten Sie bis dahin.",
  ],
};

function categorize(topic: string): TopicCat {
  const found = (Object.keys(CAT_PATTERNS) as TopicCat[]).find((c) => CAT_PATTERNS[c].test(topic));
  return found ?? "region";
}

/**
 * Prüft vor jeder Moderation, ob Kultur, Netz, Witziges und Service
 * schon vorkamen. Fehlt eine Rubrik, wird automatisch ein passendes
 * Ersatzthema gewählt, statt das Sendungsthema zu wiederholen.
 */
/** 0–5 Uhr: ruhige, aufmunternde Themen statt des Tages-Pflichtprogramms. */
function isNightHour(hour: number) {
  return hour < 5;
}

function nextModerationTopic(
  showTopics: string[],
  index: number,
  covered: Set<TopicCat>,
  hour: number,
): { topic: string; cat: TopicCat; open: TopicCat[]; fallback: boolean } {
  if (isNightHour(hour)) {
    const openNight = NIGHT_CHECKLIST.filter((c) => !covered.has(c));
    if (openNight.length === 0) NIGHT_CHECKLIST.forEach((c) => covered.delete(c));
    const cat = (openNight[0] ?? NIGHT_CHECKLIST[index % NIGHT_CHECKLIST.length]) as TopicCat;
    covered.add(cat);
    return {
      topic: pick(CAT_TOPICS[cat], index),
      cat,
      open: NIGHT_CHECKLIST.filter((c) => c !== cat),
      fallback: true,
    };
  }

  // Tagsüber zusätzlich zur Pflicht-Checkliste öfter mal eine Portion Humor einstreuen,
  // unabhängig davon, ob "witziges" laut Checkliste gerade dran wäre.
  if (index % 4 === 2) {
    covered.add("witziges");
    return {
      topic: pick(CAT_TOPICS.witziges, index + 5),
      cat: "witziges",
      open: CHECKLIST.filter((c) => !covered.has(c)),
      fallback: true,
    };
  }

  const open = CHECKLIST.filter((c) => !covered.has(c));
  if (open.length === 0) {
    CHECKLIST.forEach((c) => covered.delete(c));
    open.push(...CHECKLIST);
  }
  const openBefore = [...open];

  const candidate = pick(showTopics.length ? showTopics : ["Region im Gespräch"], index);
  const candidateCat = categorize(candidate);
  if (open.includes(candidateCat)) {
    covered.add(candidateCat);
    return { topic: candidate, cat: candidateCat, open: openBefore, fallback: false };
  }

  const cat = open[index % open.length];
  covered.add(cat);
  return { topic: pick(CAT_TOPICS[cat], index), cat, open: openBefore, fallback: true };
}

/** Nie zweimal denselben Text im Plan – und nicht immer in derselben Reihenfolge. */
function pickFresh(list: string[], used: Set<string>) {
  const open = list.filter((t) => !used.has(t));
  const source = open.length ? open : list;
  const value = source[Math.floor(Math.random() * source.length)];
  if (!open.length) list.forEach((t) => used.delete(t));
  used.add(value);
  return value;
}

function topicTalk(cat: TopicCat, used: Set<string>) {
  return pickFresh(CAT_TALK[cat], used);
}

/** Kleine menschliche Unsauberkeiten – echtes Radio klingt nicht wie ein Automat. */
const HUMAN = [
  "Ähm, Moment – ich sortiere kurz meine Zettel. So, jetzt.",
  "Ich sage Ihnen gleich – ach nein, andersrum, erst die Musik, dann das Thema.",
  "Puh, mein Kaffee ist alle. Also weiter im Programm.",
  "Ich hab's gerade selbst nochmal nachgelesen, weil ich es kaum glauben konnte.",
];

/**
 * Echte Radiomoderation: Sendung nennen, Thema ankündigen, Ausblick geben.
 * Jeder Text wird pro Sendeplan nur einmal verwendet.
 */
function moderationText(opts: {
  host: Host;
  showTitle: string;
  topic: string;
  cat: TopicCat;
  nextTopic: string;
  lastSong?: string;
  nextSongs?: string[];
  at: number;
  index: number;
  used: Set<string>;
  usedTalk: Set<string>;
}) {
  const { host, showTitle, topic, cat, nextTopic, lastSong, nextSongs, at, index, used, usedTalk } =
    opts;
  const time = spokenTime(at);
  const backAnno = lastSong
    ? `${pick(
        [
          `Das war ${lastSong} hier auf Welle Südwest.`,
          `${lastSong} – schön, oder? Sie hören Welle Südwest.`,
          `Gerade eben für Sie: ${lastSong}.`,
          `Das war ${lastSong}, und ich bleibe noch eine Weile bei Ihnen.`,
        ],
        index,
      )} `
    : "";
  const songs = (nextSongs ?? []).filter(Boolean);
  const fwd =
    songs.length >= 2
      ? ` ${pick(
          [
            `Gleich für Sie ${songs[0]}, direkt danach ${songs[1]}.`,
            `Jetzt zwei am Stück: ${songs[0]} und im Anschluss ${songs[1]}.`,
            `Musik ohne Pause – ${songs[0]}, danach ${songs[1]}.`,
          ],
          index,
        )}`
      : songs.length === 1
        ? ` ${pick(
            [
              `Gleich für Sie: ${songs[0]}.`,
              `Und hier ist ${songs[0]}.`,
              `Weiter geht es mit ${songs[0]}.`,
            ],
            index,
          )}`
        : "";
  const talk = topicTalk(cat, usedTalk);
  // Etwa jede dritte Moderation bekommt eine menschliche Unsauberkeit.
  const human = index % 3 === 0 ? `${pickFresh(HUMAN, usedTalk)} ` : "";
  const small = pickFresh(SMALLTALK, usedTalk);

  const variants = [
    `${backAnno}${human}Hier ist ${showTitle}. Es ist ${time}. Unser Thema jetzt: ${topic.toLowerCase()}. ${talk} ${small}${fwd}`,
    `${backAnno}${human}${time} auf Welle Südwest, ich bin ${host.name} und begleite Sie durch die Stunde. Mein Thema jetzt: ${topic.toLowerCase()}. ${talk} Später sprechen wir noch über ${nextTopic.toLowerCase()}.${fwd}`,
    `${backAnno}Schön, dass Sie da sind – ${showTitle}, es ist ${time}. Stichwort ${topic.toLowerCase()}: ${talk}${fwd}`,
    `${backAnno}Es ist ${time}, Sie hören ${showTitle} mit mir, ${host.name}. Und jetzt zu ${topic.toLowerCase()}: ${talk}${fwd}`,
    `${backAnno}${human}${showTitle}, ${time}. Auf meinem Zettel steht ${topic.toLowerCase()}, danach ${nextTopic.toLowerCase()}. ${talk} Nachrichten und Verkehr wie immer zur vollen und zur halben Stunde.${fwd}`,
    `${backAnno}Ich hoffe, Sie hatten bisher einen guten Tag. ${time}, ${showTitle}. ${talk} ${small}${fwd}`,
    `${backAnno}${human}Bleiben wir kurz beim Thema ${topic.toLowerCase()}. ${talk} Danach mache ich weiter mit ${nextTopic.toLowerCase()} – ${showTitle}, ${time}.${fwd}`,
  ];

  const offset = Math.floor(Math.random() * variants.length);
  for (let i = 0; i < variants.length; i++) {
    const candidate = variants[(offset + i) % variants.length];
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const fallback = `${backAnno}Es ist ${time} auf Welle Südwest, ${host.name} am Mikrofon. ${talk} ${small}${fwd}`;
  used.add(fallback);
  return fallback;
}

/** Kurze Zwischenansage über der Musik: was lief, was kommt. */
function segueText(opts: {
  showTitle: string;
  at: number;
  nextSongs?: string[];
  lastSong?: string;
  index: number;
}) {
  const { showTitle, at, nextSongs, lastSong, index } = opts;
  const songs = (nextSongs ?? []).filter(Boolean);
  const next =
    songs.length >= 2
      ? ` Jetzt ${songs[0]}, direkt danach ${songs[1]}.`
      : songs.length === 1
        ? ` Jetzt für Sie: ${songs[0]}.`
        : "";
  const back = lastSong ? `${lastSong} war das. ` : "";
  return pick(
    [
      `${back}${spokenTime(at)} auf Welle Südwest.${next}`,
      `${back}${showTitle} – Musik ohne Pause.${next}`,
      `${back}Sie hören Welle Südwest, es ist ${spokenTime(at)}.${next}`,
      `${back}Wir bleiben bei der Musik hier im Südwesten.${next}`,
    ],
    index + berlinMinute(at),
  );
}

/* ------------------------------------------------------------------- Planung */

function mediaOf(media: MediaRecord[], kind: MediaRecord["kind"], slot?: MediaRecord["slot"]) {
  const all = media.filter((m) => m.kind === kind);
  if (!slot) return all;
  const matched = all.filter((m) => m.slot === slot);
  return matched.length ? matched : all.filter((m) => !m.slot || m.slot === "allgemein");
}

function adIsActive(m: MediaRecord, at: number) {
  if (m.runFrom && at < m.runFrom) return false;
  if (m.runUntil && at > m.runUntil) return false;
  return true;
}

/** Kommerziell nutzbar? CC0/PDM/BY/BY-SA ja, NC/ND nein. */
export function isCommerciallyUsable(license?: string) {
  if (!license) return false;
  const l = license.toLowerCase();
  if (l.includes("nc") || l.includes("nd")) return false;
  return ["cc0", "pdm", "by", "by-sa", "public", "sampling+"].some((ok) => l.includes(ok));
}

type MusicSource = {
  key: string;
  title: string;
  artist: string;
  category: string;
  duration: number;
  mediaId?: string;
  streamUrl?: string;
  license?: string;
  source?: string;
};

/** Ab so vielen eigenen Titeln läuft ausschließlich die eigene Bibliothek (keine freie Musik aus
 *  dem Netz mehr) – darunter würde es zu schnell repetitiv, deshalb erst ab dieser Schwelle. */
const MIN_LIBRARY_SONGS_FOR_EXCLUSIVE = 30;

/**
 * Musikpool: eigene Bibliothek (hochgeladene Titel) zuerst, danach kostenlose,
 * kommerziell nutzbare Musik aus dem Netz (Internet Archive / Openverse) als
 * Auffüllung – damit auch ohne Uploads von Anfang an Musik läuft.
 */
function musicPool(ctx: PlanContext): MusicSource[] {
  const uploaded: MusicSource[] = ctx.media
    .filter((m) => m.kind === "music")
    .map((m) => ({
      key: m.id,
      title: m.title,
      artist: m.artist || "Unbekannt",
      category: m.category,
      duration: m.duration || 180,
      // Nur mediaId setzen, wenn es tatsächlich eine lokal hochgeladene Datei ist – bei aus dem
      // Netz übernommener freier Musik (addOnline) gibt es stattdessen eine streamUrl, direkt
      // abrufbar ohne Umweg über den Server-Datei-Speicher.
      mediaId: m.streamUrl ? undefined : m.id,
      streamUrl: m.streamUrl,
      license: m.license,
      source: m.source,
    }));
  // Sobald die eigene Bibliothek groß genug ist, läuft ausschließlich eigene Musik – die freie
  // Musik aus dem Netz ist nur eine Auffüllung, solange noch nicht genug eigene Titel da sind
  // (sonst würde die Sendung mit zu wenig Titeln schnell repetitiv).
  if (uploaded.length >= MIN_LIBRARY_SONGS_FOR_EXCLUSIVE) {
    return shuffle(uploaded);
  }
  const free: MusicSource[] = (ctx.freeMusic ?? []).map((t) => ({
    key: t.id,
    title: t.title,
    artist: t.artist || "Unbekannt",
    category: t.category,
    duration: t.duration || 180,
    streamUrl: t.streamUrl,
    license: t.license,
    source: t.source,
  }));
  return [...shuffle(uploaded), ...shuffle(free)];
}

/**
 * Baut einen Sendeplan über mehrere Stunden.
 * Nachrichten laufen sekundengenau: Anmoderation mit Themenüberblick, Trenner,
 * ausführlicher Block, danach ein gemeinsamer Verkehrsblock.
 */
export function buildPlan(opts: { from: Date; hours: number; ctx: PlanContext }): PlanItem[] {
  const { ctx } = opts;
  /** Werbung läuft ausschließlich nach erfolgreicher Bewerbung und Freigabe. */
  const campaigns = (ctx.adCampaigns ?? []).filter((c) => c.status === "freigegeben");
  const adsPerHour = Math.min(
    8,
    campaigns.reduce((sum, c) => sum + Math.max(1, c.perHour || 1), 0),
  );
  const approval = ctx.approvalRequired ?? false;
  const items: PlanItem[] = [];
  const pool = musicPool(ctx);
  const jingles = mediaOf(ctx.media, "jingle", "stundenanfang");
  const newsJingles = mediaOf(ctx.media, "jingle", "nachrichten");
  const slogans = mediaOf(ctx.media, "slogan", "allgemein");
  const artistPlays = new Map<string, number>();
  const usedModeration = new Set<string>();
  /** Bereits verwendete Witze, Smalltalks und Rubriktexte im Plan. */
  const usedTalk = new Set<string>();
  /** Themen-Checkliste über den gesamten Plan hinweg. */
  const coveredTopics = new Set<TopicCat>();

  const start = new Date(opts.from);
  start.setMinutes(0, 0, 0);
  /** Ab jetzt planen – nichts, was in der Vergangenheit liegt. */
  const firstHour = Math.max(opts.from.getTime(), Date.now());
  /** Immer so viele Stunden, dass die nächste Nachrichtenmarke enthalten ist. */
  const hourCount = Math.max(1, Math.ceil(opts.hours)) + 1;

  let musicIndex = 0;
  let generalIndex = 0;
  let lastSong: string | undefined;

  for (let h = 0; h < hourCount; h++) {
    const hourStart = new Date(start.getTime() + h * 3600_000);
    const hourEnd = hourStart.getTime() + 3600_000;
    const { show, host } = showForDate(hourStart);
    const isShowStart = berlinHour(hourStart.getTime()) === show.startHour;
    let cursor = Math.max(hourStart.getTime(), firstHour);
    if (cursor >= hourEnd) continue;

    const push = (
      item: Omit<PlanItem, "uid" | "plannedAt" | "status">,
      at?: number,
    ): PlanItem | null => {
      const plannedAt = at ?? cursor;
      if (plannedAt >= hourEnd) return null;
      // Nie rückwirkend planen – der Plan beginnt immer ab jetzt.
      if (plannedAt < firstHour - 1000) return null;
      // In geplanten Livesendungen plant der Autopilot nichts – nur manuelle Elemente.
      if (liveSlotAt(ctx.liveSlots, plannedAt)) return null;
      const full: PlanItem = {
        ...item,
        uid: uid(),
        plannedAt,
        status: "idle",
        showId: show.id,
        // Nachrichtensprecher:in, Wetter-Expert:in oder Korrespondent:in dürfen die Sendungs-
        // moderation überschreiben (siehe speak()-Aufrufe mit expliziter hostId/hostName in extra) –
        // ohne das würde hier immer wieder die Sendungsmoderation eingesetzt.
        hostId: item.hostId ?? host.id,
        hostName: item.hostName ?? host.name,
      };
      items.push(full);
      cursor = plannedAt + full.duration * 1000;
      return full;
    };

    const speak = (
      kind: ItemKind,
      title: string,
      subtitle: string,
      text: string,
      extra?: Partial<PlanItem>,
    ) =>
      push({
        kind,
        title,
        subtitle,
        duration: speakDuration(text),
        text,
        voice: host.voice,
        sponsor: null,
        needsApproval: approval,
        approved: !approval,
        ...extra,
      });

    /** Trenner-Sound zwischen den Meldungen. */
    const pushTrenner = (label: string) => {
      generalIndex++;
      const j = newsJingles.length ? pick(newsJingles, generalIndex) : null;
      if (!j) return;
      push({
        kind: "jingle",
        title: label,
        subtitle: "Trenner",
        duration: j.duration,
        mediaId: j.id,
        sponsor: null,
      });
    };

    /** Songs, die als Nächstes laufen – erst ansagen, dann abspielen. */
    let pendingBlock: MusicSource[] = [];
    const pendingTitles = () => pendingBlock.map((t) => `${t.title} von ${t.artist}`);

    /** Ein Musiktitel – maximal zwei Songs pro Interpret und Plan. */
    const selectTrack = (maxSeconds: number): MusicSource | null => {
      if (!pool.length) return null;
      for (let tries = 0; tries < pool.length; tries++) {
        const t = pool[musicIndex++ % pool.length];
        const played = artistPlays.get(t.artist) ?? 0;
        if (played >= 2) continue;
        if (t.duration > maxSeconds) continue;
        artistPlays.set(t.artist, played + 1);
        return t;
      }
      return null;
    };

    const pushTrack = (t: MusicSource) => {
      push({
        kind: "music",
        title: t.title,
        subtitle: `${t.artist} · ${t.category}${t.license ? ` · ${t.license}` : ""}`,
        duration: t.duration,
        mediaId: t.mediaId,
        streamUrl: t.streamUrl,
        license: t.license,
        source: t.source,
        sponsor: null,
      });
      lastSong = `${t.title} von ${t.artist}`;
    };

    /**
     * Maximal zwei Songs am Stück werden vorbereitet, damit die Moderation
     * davor sie exakt ansagen kann – danach laufen genau diese Titel.
     */
    const prepareBlock = (maxSeconds: number) => {
      if (pendingBlock.length) return pendingBlock;
      const first = selectTrack(maxSeconds);
      if (!first) return pendingBlock;
      const second = selectTrack(maxSeconds - first.duration - 25);
      pendingBlock = second ? [first, second] : [first];
      return pendingBlock;
    };
    const flushBlock = () => {
      const block = pendingBlock;
      pendingBlock = [];
      block.forEach((track, i) => {
        pushTrack(track);
        // Zwischen zwei Songs im selben Block sonst nichts – das klingt sonst wie eine lange
        // stille Pause. Eine kurze Senderkennung überbrückt den Übergang (spielt beim Webplayer
        // über den ausklingenden/einsetzenden Song, nicht als harter Stille-Schnitt).
        if (i < block.length - 1) pushJingle();
      });
      return block.length > 0;
    };

    const pushJingle = () => {
      generalIndex++;
      const j = jingles.length ? pick(jingles, generalIndex) : null;
      if (j) {
        push({
          kind: "jingle",
          title: j.title,
          subtitle: "Station-Element",
          duration: j.duration,
          mediaId: j.id,
          sponsor: null,
        });
        return;
      }
      const s = slogans.length ? pick(slogans, generalIndex) : null;
      if (s) {
        push({
          kind: "slogan",
          title: s.title,
          subtitle: "Slogan",
          duration: s.duration,
          mediaId: s.id,
          sponsor: null,
        });
        return;
      }
      speak("slogan", "Station-ID", "KI-Stimme", pick(SLOGANS, generalIndex));
    };

    let adsThisHour = 0;
    const pushAd = () => {
      if (!campaigns.length || adsThisHour >= adsPerHour) return false;
      generalIndex++;
      const advertisers = campaigns.map((c) => c.advertiser.toLowerCase());
      const uploaded = mediaOf(ctx.media, "ad").filter(
        (m) =>
          adIsActive(m, cursor) &&
          advertisers.some((a) => `${m.artist} ${m.title}`.toLowerCase().includes(a)),
      );
      if (uploaded.length) {
        const a = pick(uploaded, generalIndex);
        push({
          kind: "ad",
          title: `Werbung: ${a.artist || a.title}`,
          subtitle: "Werbespot",
          duration: a.duration,
          mediaId: a.id,
          sponsor: a.artist || a.title,
        });
      } else {
        const spot = pick(campaigns, generalIndex);
        speak("ad", `Werbung: ${spot.advertiser}`, "Werbespot (freigegeben)", spot.text, {
          voice: "echo",
          sponsor: spot.advertiser,
        });
      }
      adsThisHour++;
      return true;
    };

    const pushModeration = () => {
      generalIndex++;
      const { topic, cat, open, fallback } = nextModerationTopic(
        show.topics,
        generalIndex,
        coveredTopics,
        berlinHour(hourStart.getTime()),
      );
      const nextTopic = pick(show.topics, generalIndex + 1);
      const text = moderationText({
        host,
        showTitle: show.title,
        topic,
        cat,
        nextTopic,
        lastSong,
        nextSongs: pendingTitles(),
        at: cursor,
        index: generalIndex,
        used: usedModeration,
        usedTalk,
      });
      speak("moderation", `Moderation — ${host.name}`, topic, text, {
        topicCat: cat,
        topicOpen: open.filter((c) => c !== cat),
        topicCovered: CHECKLIST.filter((c) => !open.includes(c) || c === cat),
        topicFallback: fallback,
        topicRule: fallback
          ? `Rubrik „${cat}" war noch offen – Ersatzthema automatisch gewählt.`
          : `Sendungsthema passt zur offenen Rubrik „${cat}".`,
      });
      // 2er-Show: die zweite Stimme klinkt sich gelegentlich mit einer kurzen, kollegialen
      // Reaktion ein, statt dass immer nur eine Person allein spricht.
      if (show.coHostId && generalIndex % 3 === 0) {
        const coHost = hostById(show.coHostId);
        speak(
          "moderation",
          `Moderation — ${coHost.name}`,
          "Kurzer Einwurf",
          pick(COHOST_REACTIONS, generalIndex),
          { voice: coHost.voice, hostId: coHost.id, hostName: coHost.name },
        );
      }
    };

    const pushSegue = () => {
      generalIndex++;
      speak(
        "moderation",
        "Zwischenansage",
        "Übergang",
        segueText({
          showTitle: show.title,
          at: cursor,
          nextSongs: pendingTitles(),
          lastSong,
          index: generalIndex,
        }),
      );
    };

    /** Mal spricht die Sendungsmoderation selbst übers Wetter, mal eine eigene Wetter-Expert:in
     *  solo, mal als kurzes Gespräch mit Übergabe – dazu abwechselnd mit/ohne Mehrtagesausblick,
     *  damit sich das nicht jede Stunde gleich anhört. */
    const pushWeather = () => {
      const sponsor = sponsorFor("wetter");
      generalIndex++;
      const seed = generalIndex + Math.floor(cursor / 3600_000);
      const mode = seed % 3;
      const outlook = seed % 2 === 0;
      if (mode === 0) {
        speak(
          "weather",
          "Wetter",
          sponsor ? `präsentiert von ${sponsor.name}` : "Saarland & Rheinland-Pfalz",
          weatherText(host, cursor, outlook, ctx),
          { sponsor: sponsor?.name ?? null },
        );
        return;
      }
      const expert = weatherExpertFor(seed);
      if (mode === 1) {
        speak(
          "weather",
          "Wetter",
          sponsor ? `präsentiert von ${sponsor.name}` : `mit ${expert.name}`,
          weatherText(expert, cursor, outlook, ctx),
          { sponsor: sponsor?.name ?? null, voice: expert.voice, hostId: expert.id, hostName: expert.name },
        );
        return;
      }
      speak(
        "weather",
        "Wetter",
        "Übergabe an die Wetter-Expert:in",
        weatherHandoffText(host, expert, cursor),
      );
      speak(
        "weather",
        "Wetter",
        sponsor ? `präsentiert von ${sponsor.name}` : `mit ${expert.name}`,
        weatherText(expert, cursor, outlook, ctx),
        { sponsor: sponsor?.name ?? null, voice: expert.voice, hostId: expert.id, hostName: expert.name },
      );
    };

    /** Gelegentlicher Blick über die Region hinaus: die Moderation schaltet zu einer
     *  Korrespondent:in in einer anderen Stadt (Berlin, USA, Mainz, Saarbrücken, Brüssel). */
    const pushCorrespondent = () => {
      generalIndex++;
      const correspondent = correspondentFor(generalIndex + Math.floor(cursor / 3600_000));
      speak(
        "moderation",
        `Schalte zu ${correspondent.city}`,
        "Übergabe",
        correspondentHandoffText(correspondent, cursor),
      );
      speak(
        "moderation",
        `Bericht aus ${correspondent.city}`,
        correspondent.name,
        pick(CORRESPONDENT_REPORTS[correspondent.id] ?? [], generalIndex),
        { voice: correspondent.voice, hostId: correspondent.id, hostName: correspondent.name },
      );
    };

    /** Nachrichtenblock: Anmoderation → Trenner → Meldungen → Trenner → Verkehr. Läuft über
     *  eine eigene Nachrichtensprecher:in, nicht über die Sendungsmoderation – wie im echten
     *  Regionalradio üblich. */
    const pushNewsBlock = (mode: "full" | "short", at: number) => {
      const anchor = newsAnchorFor(at / 3600_000);
      const stories = newsStories(ctx, mode === "full" ? 4 : 5);
      const intro = newsIntroText(anchor, at, stories, mode);
      const body = newsBodyText(anchor, stories, mode, at);
      const first = push(
        {
          kind: "news",
          title:
            mode === "full"
              ? `Nachrichten — Anmoderation`
              : `Kurznachrichten — Anmoderation`,
          subtitle: `${clockLine(at)} Uhr · Themen`,
          duration: speakDuration(intro),
          text: intro,
          voice: anchor.voice,
          hostId: anchor.id,
          hostName: anchor.name,
          sponsor: null,
          hardStart: at,
          needsApproval: approval,
          approved: !approval,
        },
        at,
      );
      if (!first) return false;
      pushTrenner("Nachrichten-Trenner");
      push({
        kind: "news",
        title: mode === "full" ? "Nachrichten" : "Kurznachrichten",
        subtitle: `${clockLine(at)} Uhr · ${mode === "full" ? "ausführlich" : "kompakt"}`,
        // Keine künstliche Mindestdauer mehr erzwingen – die reale Sprechzeit entscheidet, sonst
        // wartet die Sendung nach dem Ende der eigentlichen Nachrichten noch auf eine erfundene
        // Mindestlänge (stille Pause). Die Server-Engine korrigiert die Dauer ohnehin nochmal auf
        // die tatsächlich gemessene Audiolänge, sobald sie erzeugt wurde.
        duration: speakDuration(body),
        text: body,
        voice: anchor.voice,
        hostId: anchor.id,
        hostName: anchor.name,
        sponsor: null,
        needsApproval: approval,
        approved: !approval,
      });
      pushTrenner("Verkehrs-Sweeper");
      speak(
        "traffic",
        "Verkehr Saarland & Rheinland-Pfalz",
        "Regionaler Verkehrsservice",
        trafficText(ctx, cursor),
        { sponsor: sponsorFor("verkehr")?.name ?? null },
      );
      // Gemeldete Blitzer bekommen einen eigenen, immer hörbaren Block.
      const blitzer = blitzerLine(ctx);
      if (blitzer) {
        speak("traffic", "Blitzer-Service", `${blitzerCount(ctx)} Hörermeldungen`, blitzer);
      }
      // Wichtige Meldungen werden nicht fest eingeplant, sondern nur spontan
      // eingeblendet, wenn eine neue Gefahrenlage hereinkommt.
      return true;
    };

    // --- Feste Zeitmarke: Nachrichten zur vollen Stunde ---
    if (cursor <= hourStart.getTime()) {
      pushJingle();
      pushNewsBlock("full", hourStart.getTime());
      if (isShowStart) {
        const opener = `${showTitleWithHost(show, host)}. Vier Stunden ${show.colour} für das Saarland und Rheinland-Pfalz. Heute sprechen wir unter anderem über ${show.topics
          .join(", ")
          .toLowerCase()}. Schön, dass Sie dabei sind.`;
        speak("showopener", showTitleWithHost(show, host), "Sendungs-Opener", opener);
      }
    }

    const halfPast = hourStart.getTime() + 30 * 60_000;
    const rotation = [
      "moderation",
      "ad",
      "segue",
      "weather",
      "ad",
      "moderation",
      "jingle",
      "korrespondent",
    ] as const;
    let rotationIndex = 0;

    const fillUntil = (limit: number) => {
      let guard = 0;
      while (cursor < limit - 20_000 && guard++ < 30) {
        const before = cursor;
        const live = liveSlotAt(ctx.liveSlots, cursor);
        if (live) {
          cursor = live.startAt + live.minutes * 60_000;
          continue;
        }
        // Erst die nächsten (maximal zwei) Songs festlegen …
        const remaining = Math.floor((limit - cursor) / 1000);
        if (remaining >= 90) prepareBlock(remaining - 40);
        const next = rotation[rotationIndex++ % rotation.length];
        // … dann genau einmal ansagen, danach abspielen. Nie doppelt.
        if (next === "moderation") pushModeration();
        else if (next === "segue") pushSegue();
        else if (next === "korrespondent") pushCorrespondent();
        else {
          if (next === "ad") {
            if (!pushAd()) pushJingle();
          } else if (next === "weather") pushWeather();
          else pushJingle();
          if (pendingBlock.length) pushSegue();
        }
        flushBlock();
        if (cursor === before) break;
      }
      if (cursor < limit) cursor = limit;
    };

    fillUntil(halfPast);
    pushNewsBlock("short", halfPast);
    fillUntil(hourEnd);
  }

  return items.sort((a, b) => a.plannedAt - b.plannedAt);
}

export function upcomingShows(from: Date, count: number) {
  const out: Array<{ start: Date; title: string; host: string; colour: string }> = [];
  const at = from.getTime();
  // Auf den Beginn der aktuellen 4-Stunden-Sendung in deutscher Ortszeit zurückrechnen (nicht in
  // der Zeitzone des Servers) – Sekunden/Millisekunden sind zeitzonenunabhängig, da Europe/Berlin
  // sich von UTC immer um ganze Stunden unterscheidet.
  const hour = berlinHour(at);
  const minute = berlinMinute(at);
  const blockStartHour = Math.floor(hour / 4) * 4;
  const secondsIntoBlock = (hour - blockStartHour) * 3600 + minute * 60 + new Date(at).getSeconds();
  const base = at - secondsIntoBlock * 1000 - new Date(at).getMilliseconds();
  for (let i = 0; i < count; i++) {
    const d = new Date(base + i * 4 * 3600_000);
    const { show, host } = showForDate(d);
    out.push({ start: d, title: show.title, host: host.name, colour: show.colour });
  }
  return out;
}

export const ALL_SHOWS = SHOWS;
