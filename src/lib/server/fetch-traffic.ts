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
  }>;
  errors: Array<{ road: string; error: string }>;
};

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
  // RSS-Artikel nur übernehmen, wenn sie nicht dieselbe Lage wie eine API-Meldung beschreiben.
  const merged = [
    ...apiItems,
    ...rss.items.filter(
      (i) => !apiItems.some((api) => sameLocation(i.road, `${i.headline} ${i.message}`, api)),
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
