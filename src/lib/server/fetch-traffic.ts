import { isRegionalTraffic } from "@/lib/autobahn-exits";
import { fetchTrafficRss } from "./fetch-traffic-rss";

/** fetch mit Timeout – ein einzelner hängender Endpunkt darf die Engine nie für immer blockieren. */
async function fetchWithTimeout(url: string, ms: number, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Offizielle Autobahn-API des Bundes (verkehr.autobahn.de) – wiederverwendbar für Route + Engine. */
const ROADS: Record<"Saarland" | "Rheinland-Pfalz", string[]> = {
  Saarland: ["A1", "A6", "A8", "A62", "A620", "A623"],
  "Rheinland-Pfalz": [
    "A1",
    "A3",
    "A6",
    "A8",
    "A48",
    "A60",
    "A61",
    "A62",
    "A63",
    "A64",
    "A65",
    "A602",
  ],
};

const LOCAL_ONLY = new Set(["A62", "A63", "A64", "A602", "A620", "A623"]);

type Warning = {
  identifier?: string;
  title?: string;
  subtitle?: string;
  description?: string[];
  startTimestamp?: string;
};

export type TrafficResult = {
  fetchedAt: string;
  items: Array<{
    id: string;
    road: string;
    region: "Saarland" | "Rheinland-Pfalz";
    headline: string;
    message: string;
    since: string | null;
    source?: "api" | "rss";
  }>;
  errors: Array<{ road: string; error: string }>;
};

/** Wie alt ein RSS-Artikel höchstens sein darf, bevor er nicht mehr vorgelesen wird – ein
 *  Nachrichtenartikel über einen Vorfall von heute Morgen taucht sonst im Feed noch stundenlang
 *  unverändert auf, obwohl die Lage inzwischen oft längst vorbei ist ("immer dasselbe" trotz
 *  Zeitablauf). Gilt NICHT für die offizielle Autobahn-API (source "api") – die liefert nur
 *  wirklich noch aktive Lagen, verschwindet von selbst, sobald etwas erledigt ist. */
const RSS_MAX_AGE_MS = 3 * 3600_000;

function isFreshEnough(item: { since: string | null; source?: "api" | "rss" }): boolean {
  if (item.source !== "rss") return true;
  if (!item.since) return true; // kein Datum bekannt – lieber behalten als fälschlich rauswerfen
  const t = Date.parse(item.since);
  if (Number.isNaN(t)) return true;
  return Date.now() - t < RSS_MAX_AGE_MS;
}

/** True, wenn zwei Meldungen offenbar dieselbe Lage beschreiben (gleiche Straße UND gleiche
 *  Orts-/Abschnittsangabe) – verhindert, dass ein Vorfall doppelt vorgelesen wird (erst aus der
 *  offiziellen Autobahn-API, dann aus einem RSS-Artikel über denselben Vorfall). */
function sameLocation(road: string, text: string, other: TrafficResult["items"][number]): boolean {
  const key = road.replace(/\s+/g, "").toUpperCase();
  const otherRoad = other.road.replace(/\s+/g, "").toUpperCase();
  if (!key || key !== otherRoad) return false;
  // Bekannte Orts-/Abschnittswörter aus beiden Texten: wenn mindestens eines übereinstimmt,
  // ist es praktisch dieselbe Lage.
  const own =
    text.match(/(?:zwischen\s+)?([A-ZÄÖÜ][\wäöüß.-]+(?:\s(?:und\s)?[A-ZÄÖÜ][\wäöüß.-]+){0,3})/g) ??
    [];
  const otherText = `${other.headline} ${other.message}`;
  return own.some((w) => w.length >= 3 && otherText.includes(w));
}

export async function fetchTraffic(): Promise<TrafficResult> {
  const jobs = (Object.keys(ROADS) as Array<keyof typeof ROADS>).flatMap((region) =>
    ROADS[region].map(async (road) => {
      try {
        const res = await fetchWithTimeout(
          `https://verkehr.autobahn.de/o/autobahn/${road}/services/warning`,
          6000,
          { headers: { accept: "application/json" } },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { warning?: Warning[] };
        const items = (data.warning ?? []).map((w, i) => {
          const headline = (w.title ?? w.subtitle ?? "Verkehrsmeldung").replace(/\s+/g, " ").trim();
          const message = (w.description ?? []).join(" ").replace(/\s+/g, " ").trim().slice(0, 400);
          return {
            id: w.identifier ?? `${road}-${i}`,
            road,
            region,
            headline,
            message,
            since: w.startTimestamp ?? null,
            source: "api" as const,
          };
        });

        return {
          region,
          road,
          error: null as string | null,
          items: items
            .filter(
              (item) =>
                LOCAL_ONLY.has(road) ||
                isRegionalTraffic(road, `${item.headline} ${item.message}`, region),
            )
            .slice(0, 3),
        };
      } catch (err) {
        return {
          region,
          road,
          items: [] as TrafficResult["items"],
          error: err instanceof Error ? err.message : "Nicht erreichbar",
        };
      }
    }),
  );

  // RSS-Feeds (SWR, Google-News) als zweite Quelle parallel abrufen – deckt auch Bundesstraßen
  // und lokale Lagen ab, die die offizielle Autobahn-API nicht führt.
  const [results, rss] = await Promise.all([
    Promise.all(jobs),
    fetchTrafficRss().catch(() => ({ items: [] as TrafficResult["items"], errors: [] })),
  ]);

  const apiItems = results.flatMap((r) => r.items).filter((i) => i.message || i.headline);
  // RSS-Artikel nur übernehmen, wenn sie nicht dieselbe Lage wie eine API-Meldung beschreiben UND
  // noch frisch genug sind (siehe RSS_MAX_AGE_MS) – ein Artikel von heute Morgen soll nicht noch
  // Stunden später unverändert vorgelesen werden.
  const merged = [
    ...apiItems,
    ...rss.items
      .map((i) => ({ ...i, source: "rss" as const }))
      .filter(
        (i) =>
          isFreshEnough(i) &&
          !apiItems.some((api) => sameLocation(i.road, `${i.headline} ${i.message}`, api)),
      ),
  ];

  return {
    fetchedAt: new Date().toISOString(),
    items: merged,
    errors: [
      ...results
        .filter((r): r is typeof r & { error: string } => Boolean(r.error))
        .map((r) => ({ road: r.road, error: r.error })),
      ...rss.errors.map((r) => ({ road: r.source, error: r.error })),
    ],
  };
}
