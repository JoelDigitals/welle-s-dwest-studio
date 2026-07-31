import { isRegionalTraffic } from "@/lib/autobahn-exits";

/**
 * Zusätzliche Verkehrsquellen per RSS: die offizielle Autobahn-API (fetch-traffic.ts) liefert nur
 * Autobahn-Warnmeldungen. Die RSS-Feeds decken darüber hinaus auch Bundesstraßen, Ortsumgehungen
 * und Ereignisse ab, die nicht als TMC-Warnung laufen (z. B. Polizei-/Blaulichtmeldungen). Gefiltert
 * wird streng auf echte, aktuelle Lagen in Saarland/RLP – Vorhersagen ("Stauprognose", "drohen"),
 * generische Ferien-/Wochenend-Themen und Meldungen aus anderen Regionen fliegen raus.
 */

type TrafficFeed = { region: "Saarland" | "Rheinland-Pfalz"; url: string; source: string };

const TRAFFIC_FEEDS: TrafficFeed[] = [
  // SWR-Verkehrsrubrik (offizieller Regionalverband für RLP) – geprüfter RSS-Pfad.
  {
    region: "Rheinland-Pfalz",
    url: "https://www.swr.de/~rss/swraktuell/verkehr-144.xml",
    source: "SWR-Verkehr",
  },
  // Google-News-Suchen gezielt nach Unfällen/Sperrungen statt nach "Stau" (das liefert vor allem
  // Ferien-/Wochenend-Vorhersagen) – decken auch lokale Lagen ab (SOL.de, SZ, Polizeimeldungen).
  {
    region: "Saarland",
    url: "https://news.google.com/rss/search?q=unfall+oder+sperrung+oder+vollsperrung+saarland&hl=de&gl=DE&ceid=DE:de",
    source: "Google-News-Saarland",
  },
  {
    region: "Rheinland-Pfalz",
    url: "https://news.google.com/rss/search?q=unfall+oder+sperrung+oder+vollsperrung+%22rheinland-pfalz%22&hl=de&gl=DE&ceid=DE:de",
    source: "Google-News-RLP",
  },
];

/** Echte, bereits eingetretene Verkehrslagen – nur solche Meldungen kommen in den Verkehrsblock. */
const INCIDENT =
  /\bstau\b|stockend|stillstand|unfall|verkehrsunfall|vollsperrung|teilsperrung|gesperrt|sperrung|verkehrsbehinderung|auffahrunfall|reisezeitverlust|ampelausfall|blitzer|geblitzt/i;

/** Zukunfts-/Allgemeinmeldungen, die keine aktuelle Lage beschreiben – die fliegen raus. */
const FORECAST =
  /\bstau.?gefahr\b|stauprognose|prognose|droht|drohen|warnt|warnung|erwartet|ferienbeginn|wochenende|pfingst|weihnachts|ostern|verkehrsaufkommen|erhöhtes\s+verkehrs|reisezeit/i;

/** Orte, die eindeutig im jeweiligen Sendegebiet liegen – fängt auch Meldungen ohne Autobahn. */
const REGION_WORDS: Record<"Saarland" | "Rheinland-Pfalz", string[]> = {
  Saarland: [
    "Saarland",
    "Saarbrücken",
    "Saarlouis",
    "Völklingen",
    "Neunkirchen",
    "St. Ingbert",
    "Sankt Ingbert",
    "Homburg",
    "Merzig",
    "Sulzbach",
    "Dillingen",
    "Püttlingen",
    "Blieskastel",
    "St. Wendel",
    "Sankt Wendel",
    "Wadern",
    "Lebach",
    "Ottweiler",
    "Losheim",
    "Quierschied",
    "Friedrichsthal",
    "Schiffweiler",
    "Beckingen",
    "Heusweiler",
    "Nonnweiler",
    "Eppelborn",
    "Illingen",
  ],
  "Rheinland-Pfalz": [
    "Rheinland-Pfalz",
    "Trier",
    "Mainz",
    "Koblenz",
    "Kaiserslautern",
    "Ludwigshafen",
    "Worms",
    "Speyer",
    "Frankenthal",
    "Pirmasens",
    "Zweibrücken",
    "Neuwied",
    "Bingen",
    "Bad Kreuznach",
    "Andernach",
    "Idar-Oberstein",
    "Bitburg",
    "Wittlich",
    "Landau",
    "Neustadt an der Weinstraße",
    "Boppard",
    "Montabaur",
    "Alzey",
    "Mayen",
    "Eifel",
    "Hunsrück",
    "Mosel",
    "Pfalz",
  ],
};

/** fetch mit Timeout – ein einzelner hängender Feed darf die Engine nie für immer blockieren. */
async function fetchWithTimeout(url: string, ms: number, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function decode(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
}

type RssItem = {
  id: string;
  road: string;
  region: "Saarland" | "Rheinland-Pfalz";
  source: string;
  headline: string;
  message: string;
  since: string | null;
};

function parseRss(xml: string, feed: TrafficFeed, limit: number): RssItem[] {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  return items.slice(0, limit).map((block, index) => {
    const headline = tag(block, "title");
    const message = tag(block, "description").slice(0, 400);
    return {
      id: `${feed.source}-${index}-${tag(block, "guid") || tag(block, "link") || index}`,
      road: roadOf(`${headline} ${message}`),
      region: feed.region,
      source: feed.source,
      headline,
      message,
      since: tag(block, "pubDate") || null,
    };
  });
}

/** Straße aus dem Meldungstext ziehen (A1, B9 …), sonst leer – für die regionale Filterung. */
function roadOf(text: string): string {
  const m = text.match(/\b([AB]\d{1,4})\b/);
  return m ? m[1].toUpperCase() : "";
}

/** Passt die Meldung zu bekannten Stellen im Sendegebiet (Autobahnabschnitt ODER Ortsname)? */
function isRegionMatch(item: RssItem): boolean {
  const text = `${item.headline} ${item.message}`;
  const road = roadOf(text);
  if (road && isRegionalTraffic(road, text, item.region)) return true;
  return REGION_WORDS[item.region].some((word) => text.toLowerCase().includes(word.toLowerCase()));
}

/** Liefert die relevanten Verkehrsmeldungen aus den RSS-Feeds (unabhängig von der Autobahn-API). */
export async function fetchTrafficRss(limitPerFeed = 8): Promise<{
  items: RssItem[];
  errors: Array<{ source: string; error: string }>;
}> {
  const results = await Promise.all(
    TRAFFIC_FEEDS.map(async (feed) => {
      try {
        const res = await fetchWithTimeout(feed.url, 6000, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/rss+xml,application/xml,text/xml,*/*",
            "Accept-Language": "de-DE,de;q=0.9",
          },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const items = parseRss(await res.text(), feed, limitPerFeed)
          .filter((i) => {
            const text = `${i.headline} ${i.message}`;
            return INCIDENT.test(text) && !FORECAST.test(text) && isRegionMatch(i);
          })
          .slice(0, 5);
        return { feed, items, error: null as string | null };
      } catch (err) {
        return {
          feed,
          items: [] as RssItem[],
          error: err instanceof Error ? err.message : "Feed nicht erreichbar",
        };
      }
    }),
  );

  const kept = results.flatMap((r) => r.items);
  // Derselbe Vorfall läuft oft in mehreren Feeds (z. B. n-tv-Meldung in Saarland- und RLP-Suche) –
  // nach Straße + normalisierter Schlagzeile deduplizieren, damit nichts doppelt vorgelesen wird.
  const seen = new Set<string>();
  const items = kept.filter((i) => {
    const key = `${i.road}|${i.headline.toLowerCase().replace(/[^a-zäöüß0-9]/g, "")}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    items,
    errors: results
      .filter((r): r is typeof r & { error: string } => Boolean(r.error))
      .map((r) => ({ source: r.feed.source, error: r.error })),
  };
}
