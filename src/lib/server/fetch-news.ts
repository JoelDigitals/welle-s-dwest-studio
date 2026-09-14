/** Wiederverwendbare Nachrichten-Feed-Logik – vom Route-Handler und von der Server-Engine genutzt. */
type Region = "Saarland" | "Rheinland-Pfalz" | "Deutschland" | "Europa" | "Welt";

type Feed = { region: Region; url: string; source: string };

const FEEDS: Feed[] = [
  // sr.de (index~rss2.xml) und sol.de liefern inzwischen 404/403 (Feed abgeschaltet bzw. hart
  // gegen Bots blockiert, auch mit Browser-Headern) – Saarbrücker Zeitung + die offizielle
  // Landesregierungs-Pressemitteilung sind gegen den echten Server geprüft und liefern aktuell
  // echte Inhalte.
  { region: "Saarland", url: "https://www.saarbruecker-zeitung.de/feed.rss", source: "SZ" },
  {
    region: "Saarland",
    url: "https://www.saarland.de/DE/presse-informationen/informationen/rss-feed",
    source: "Landesregierung",
  },
  // Der alte "index~rss2.xml"-Pfad liefert 404 (SWR hat auf "~rss/.../index.xml" umgestellt,
  // ebenso wie rheinpfalz.de, das komplett abgeschaltet ist) – gegen den echten Server geprüft.
  {
    region: "Rheinland-Pfalz",
    url: "https://www.swr.de/~rss/swraktuell/rheinland-pfalz/index.xml",
    source: "SWR",
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

/** Entfernt EINMAL CDATA-Hülle, dekodiert die gängigen Entities, strippt danach HTML-Tags. */
function decodeOnce(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Manche Feeds (z.B. SWR) nutzen numerische statt benannte Entities (&#034; statt &quot;).
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "");
}

/** Manche Feeds liefern Felder DOPPELT entity-kodiert (siehe fetch-traffic-rss.ts) – ein
 *  einzelner Dekodier-Durchlauf lässt dann rohe "&nbsp;"-Reste oder ganze Tags als Klartext
 *  übrig. Der zweite, idempotente Durchlauf räumt das zuverlässig auf. */
function decode(value: string) {
  return decodeOnce(decodeOnce(value)).replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
}

/** Bild-URL aus <enclosure url="..." type="image/..."> oder <media:content url="..." ...> -
 *  fast jeder Feed liefert eins mit, bisher ungenutzt. */
function imageOf(block: string): string | undefined {
  const enclosure = block.match(/<enclosure\b[^>]*\burl="([^"]+)"[^>]*\btype="image\/[^"]*"/i);
  if (enclosure) return enclosure[1];
  const media = block.match(/<media:content\b[^>]*\burl="([^"]+)"/i);
  if (media) return media[1];
  return undefined;
}

/** Regionale Zeitungs-Feeds (SZ, SWR) mischen unter derselben Rubrik oft auch überregionale
 *  Meldungen (Agenturmeldungen zu Bund/EU/Welt) - "kommt von der SZ" bedeutet deshalb NICHT
 *  automatisch "ist eine Saarland-Meldung" (siehe Nutzer-Feedback). Der Inhalt entscheidet: nur
 *  wenn Schlagzeile/Text ein klares Signal für eine ANDERE Region liefern und KEIN Bezug zur
 *  Heimatregion des Feeds erkennbar ist, wird umklassifiziert - sonst bleibt es bei der
 *  Feed-Region (die für echte Lokalmeldungen ohne wörtliche Ortsnennung weiterhin die beste
 *  verfügbare Annahme ist). */
const SAARLAND_RE =
  /\bSaarland\b|\bSaarbrücken\b|\bSaarlouis\b|\bNeunkirchen\b|\bVölklingen\b|\bHomburg\b|\bMerzig\b|\bSt\.?\s?Wendel\b|\bSaarpfalz\b|\bSaarwellingen\b|\bDillingen\b|\bsaarländisch/i;
const RLP_RE =
  /\bRheinland-Pfalz\b|\bMainz\b|\bTrier\b|\bKoblenz\b|\bKaiserslautern\b|\bLudwigshafen\b|\bWorms\b|\bLandau\b|\bSpeyer\b|\b(?:Vorder|Süd|West)?pfalz\b|\bMosel\b|\bWesterwald\b|\bHunsrück\b|\brheinland-pfälzisch/i;
const EUROPE_RE =
  /\bEU\b|\bEU-\w+|\bEuropäische Union\b|\bEuropäischen Union\b|\bBrüssel\b|\bEuropaparlament\b|\bEU-Kommission\b|\bEU-Gipfel\b|\beuropaweit\b|\bEurozone\b|\bStraßburg\b|\bEU-Staaten\b/;
const GERMANY_RE =
  /\bBundestag\b|\bBundesregierung\b|\bBundeskanzler\w*\b|\bBund-Länder\b|\bdeutschlandweit\b|\bBundesländer\b|\bBundesrat\b|\bBundesweit\b/;

function classifyRegion(headline: string, body: string, feedRegion: Region): Region {
  // Die dedizierten tagesschau-Inland/Ausland-Feeds (Region Deutschland/Welt) sind bereits
  // zuverlässig getrennt - nur die regionalen Zeitungs-Feeds (Saarland/Rheinland-Pfalz) neigen
  // zum Vermischen und werden deshalb geprüft.
  if (feedRegion !== "Saarland" && feedRegion !== "Rheinland-Pfalz") return feedRegion;
  const text = `${headline} ${body}`;
  const home = feedRegion === "Saarland" ? SAARLAND_RE.test(text) : RLP_RE.test(text);
  if (home) return feedRegion;
  if (feedRegion === "Saarland" && RLP_RE.test(text)) return "Rheinland-Pfalz";
  if (feedRegion === "Rheinland-Pfalz" && SAARLAND_RE.test(text)) return "Saarland";
  if (EUROPE_RE.test(text) && !GERMANY_RE.test(text)) return "Europa";
  if (GERMANY_RE.test(text)) return "Deutschland";
  return feedRegion;
}

function parseRss(xml: string, feed: Feed, limit: number) {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  return items.slice(0, limit).map((block, index) => {
    const headline = tag(block, "title");
    const body = tag(block, "description");
    return {
      // WICHTIG: die id darf NICHT von "index" (Position im Feed beim jeweiligen Abruf) abhängen -
      // dieselbe Meldung rutscht zwischen zwei Abrufen oft an eine andere Position (neuere Meldungen
      // schieben sich davor), bekäme mit einem index-Präfix also bei JEDEM Refresh eine NEUE id und
      // würde als "neuer" Artikel erneut gespeichert - der Grund für sehr viele doppelte Artikel zur
      // selben Meldung. guid/link sind stabil, "index" ist nur der allerletzte Rückfall, falls ein
      // Feed-Item ausnahmsweise keins von beidem liefert.
      id: `${feed.source}-${tag(block, "guid") || tag(block, "link") || `idx${index}`}`,
      region: classifyRegion(headline, body, feed.region),
      source: feed.source,
      headline,
      body,
      link: tag(block, "link"),
      publishedAt: tag(block, "pubDate"),
      imageUrl: imageOf(block),
    };
  });
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
        // Ein reiner Automations-User-Agent ohne Accept/Accept-Language wird von manchen
        // Seiten (z. B. saarland.de) als Bot geblockt (403) – mit vollständigeren, browser-
        // ähnlichen Headern klappt derselbe Abruf (gegen den echten Server geprüft).
        const res = await fetchWithTimeout(feed.url, 6000, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/rss+xml,application/xml,text/xml,*/*",
            "Accept-Language": "de-DE,de;q=0.9",
          },
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
