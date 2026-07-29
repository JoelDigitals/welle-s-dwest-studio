/** Wiederverwendbare Nachrichten-Feed-Logik – vom Route-Handler und von der Server-Engine genutzt. */
type Region = "Saarland" | "Rheinland-Pfalz" | "Deutschland" | "Welt";

type Feed = { region: Region; url: string; source: string };

const FEEDS: Feed[] = [
  { region: "Saarland", url: "https://www.sr.de/sr/home/nachrichten/index~rss2.xml", source: "SR" },
  { region: "Saarland", url: "https://www.sol.de/feed/", source: "sol" },
  { region: "Saarland", url: "https://www.sol.de/blaulicht/feed/", source: "blaulicht" },
  {
    region: "Rheinland-Pfalz",
    url: "https://www.swr.de/swraktuell/rheinland-pfalz/index~rss2.xml",
    source: "SWR",
  },
  {
    region: "Rheinland-Pfalz",
    url: "https://www.rheinpfalz.de/rss/feed/rheinpfalz-startseite",
    source: "RP",
  },
  // Eigene Inland-/Ausland-Feeds statt des gemischten Haupt-Feeds, damit "Deutschland" und "Welt"
  // wirklich getrennte Rubriken sind statt beides unter "Welt" zusammenzuwerfen (URLs gegen den
  // echten Server geprüft, da tagesschau.de die alten "xml/rss2_inland"-Pfade nicht mehr bedient).
  {
    region: "Deutschland",
    url: "https://www.tagesschau.de/inland/index~rss2.xml",
    source: "tagesschau-inland",
  },
  {
    region: "Welt",
    url: "https://www.tagesschau.de/ausland/index~rss2.xml",
    source: "tagesschau-ausland",
  },
];

/** Blaulicht-/Verkehrsmeldungen (Unfälle, Staus, Sperrungen) zählen nicht als reguläre
 *  Saarland/RLP-News – dafür gibt es den eigenen Verkehrsblock (fetch-traffic.ts), sonst kommt
 *  derselbe Vorfall doppelt vor: einmal als "Nachricht", einmal als Verkehrsmeldung. */
const TRAFFIC_LIKE =
  /\bstau\b|\bunfall\b|verkehrsunfall|vollsperrung|teilsperrung|ampelausfall|blitzer|geblitzt|verkehrsbehinderung|auffahrunfall|a\d{1,3}\b.*(sperr|stau|unfall)/i;

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

function parseRss(xml: string, feed: Feed, limit: number) {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  return items.slice(0, limit).map((block, index) => ({
    id: `${feed.source}-${index}-${tag(block, "guid") || tag(block, "link") || index}`,
    region: feed.region,
    source: feed.source,
    headline: tag(block, "title"),
    body: tag(block, "description"),
    link: tag(block, "link"),
    publishedAt: tag(block, "pubDate"),
  }));
}

export type NewsResult = {
  fetchedAt: string;
  items: ReturnType<typeof parseRss>;
  errors: Array<{ source: string; error: string }>;
};

export async function fetchNews(limit = 4): Promise<NewsResult> {
  const clamped = Math.min(10, Math.max(1, limit));
  const results = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const res = await fetchWithTimeout(feed.url, 6000, {
          headers: { "User-Agent": "WelleSuedwest/1.0 (Radioautomation)" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return {
          feed,
          items: parseRss(await res.text(), feed, clamped),
          error: null as string | null,
        };
      } catch (err) {
        return {
          feed,
          items: [] as ReturnType<typeof parseRss>,
          error: err instanceof Error ? err.message : "Feed nicht erreichbar",
        };
      }
    }),
  );

  return {
    fetchedAt: new Date().toISOString(),
    items: results
      .flatMap((r) => r.items)
      .filter((i) => i.headline && !TRAFFIC_LIKE.test(`${i.headline} ${i.body}`)),
    errors: results
      .filter((r): r is typeof r & { error: string } => Boolean(r.error))
      .map((r) => ({ source: r.feed.source, error: r.error })),
  };
}
