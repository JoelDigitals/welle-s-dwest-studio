import { isRegionalTraffic } from "@/lib/autobahn-exits";

/**
 * Blitzer und Verkehrsmeldungen der Regionalsender (Regel 3 in station-rules.ts):
 *  - Radio Salü (Saarland): RSS-Feed salue.de/stausblitzer/staus.xml – Blitzer, Verkehrs- und
 *    Gefahrenmeldungen, jeweils mit Zeitstempel.
 *  - RPR1 (Rheinland-Pfalz): JSON unter rpr1.de/traffic – Verkehr je Straße, Blitzer unter "traps".
 * Die Quellen stehen nur in den Metadaten, im Sprechtext werden sie nie genannt.
 * Ergebnis null = Abruf fehlgeschlagen (dann wird beim Abgleich NICHTS gelöscht).
 */
export type StationReport = {
  id: string;
  source: "salue" | "rpr1";
  type: "blitzer" | "verkehr";
  region: "Saarland" | "Rheinland-Pfalz";
  road: string;
  title: string;
  /** Zeitpunkt laut Quelle; fehlt er (RPR1), gilt der erste Abruf (siehe station-reports-store). */
  reportedAt: number | null;
};

const UA = "Mozilla/5.0 (compatible; WelleSuedwestBot/1.0)";
const RLP_HINT =
  /(trier|kaiserslautern|pirmasens|zweibrücken|ernstweiler|landstuhl|koblenz|mainz|pfalz|hunsrück|mosel|schweich|wittlich|idar|birkenfeld|kusel|ludwigshafen|worms|speyer|landau|bitburg|prüm)/i;

async function fetchWithTimeout(url: string, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { headers: { "user-agent": UA }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Kurzer, stabiler Hash – gleiche Meldung = gleiche ID über alle Abrufe hinweg. */
function hash(text: string) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function roadOf(text: string) {
  return (
    text
      .match(/\b([AB])\s?(\d{1,3})\b/)
      ?.slice(1)
      .join("") ?? ""
  );
}

/** "07.10.2026 17:16" (deutsche Ortszeit) -> Epoch ms. */
function parseBerlin(date: string, time: string): number | null {
  const [d, m, y] = date.split(".").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (!d || !m || !y) return null;
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Offset von Europe/Berlin zu genau diesem Zeitpunkt (Sommer-/Winterzeit) bestimmen.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asBerlin = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return guess - (asBerlin - guess);
}

function decodeEntities(text: string) {
  return text
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchSalueReports(): Promise<StationReport[] | null> {
  try {
    const res = await fetchWithTimeout("https://www.salue.de/stausblitzer/staus.xml", 10_000);
    if (!res.ok) return null;
    const xml = new TextDecoder("iso-8859-1").decode(await res.arrayBuffer());
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
    const out: StationReport[] = [];
    for (const item of items) {
      const rawTitle = decodeEntities(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
      const desc = decodeEntities(item.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? "");
      const [kind, ...rest] = rawTitle.split("::");
      const title = rest.join("::").trim();
      if (!title) continue;
      const type = /blitzer/i.test(kind) ? "blitzer" : "verkehr";
      const stamp = desc.match(/(\d{2}\.\d{2}\.\d{4})\s+(\d{1,2}:\d{2})/);
      out.push({
        id: `salue-${hash(rawTitle)}`,
        source: "salue",
        type,
        region: RLP_HINT.test(title) ? "Rheinland-Pfalz" : "Saarland",
        road: roadOf(title),
        title,
        reportedAt: stamp ? parseBerlin(stamp[1], stamp[2]) : null,
      });
    }
    return out;
  } catch {
    return null;
  }
}

type Rpr1Entry = { title?: string; description?: string; roadName?: string };
type Rpr1Trap = Record<string, unknown>;

function trapText(t: Rpr1Trap): string {
  const pick = (k: string) => (typeof t[k] === "string" ? (t[k] as string).trim() : "");
  const direct = pick("title") || pick("description") || pick("text") || pick("info");
  if (direct) return direct;
  return [pick("street"), pick("city"), pick("location"), pick("direction")]
    .filter(Boolean)
    .join(", ");
}

export async function fetchRpr1Reports(): Promise<StationReport[] | null> {
  try {
    const res = await fetchWithTimeout("https://www.rpr1.de/traffic", 10_000);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      traffic?: Record<string, Rpr1Entry[]>;
      traps?: { mobile?: Rpr1Trap[]; static?: Rpr1Trap[] };
    };
    const out: StationReport[] = [];
    for (const [roadName, entries] of Object.entries(data.traffic ?? {})) {
      for (const e of entries ?? []) {
        const title = (e.title ?? "").replace(/\s+/g, " ").trim();
        if (!title) continue;
        // RPR1 meldet auch Hessen/Baden-Württemberg – nur Abschnitte in Rheinland-Pfalz.
        if (
          !isRegionalTraffic(e.roadName ?? roadName, title, "Rheinland-Pfalz") &&
          !RLP_HINT.test(title)
        )
          continue;
        out.push({
          id: `rpr1-${hash(title)}`,
          source: "rpr1",
          type: "verkehr",
          region: "Rheinland-Pfalz",
          road: e.roadName ?? roadName,
          title,
          reportedAt: null,
        });
      }
    }
    // Nur mobile Blitzer – fest installierte Anlagen ("static") sind keine aktuelle Meldung.
    for (const t of data.traps?.mobile ?? []) {
      const title = trapText(t).replace(/\s+/g, " ");
      if (!title) continue;
      out.push({
        id: `rpr1-${hash(`blitzer ${title}`)}`,
        source: "rpr1",
        type: "blitzer",
        region: "Rheinland-Pfalz",
        road: roadOf(title),
        title,
        reportedAt: null,
      });
    }
    return out;
  } catch {
    return null;
  }
}
