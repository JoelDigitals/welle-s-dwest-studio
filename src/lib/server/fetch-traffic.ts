import { isRegionalTraffic } from "@/lib/autobahn-exits";

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

  const results = await Promise.all(jobs);
  return {
    fetchedAt: new Date().toISOString(),
    items: results.flatMap((r) => r.items).filter((i) => i.message || i.headline),
    errors: results
      .filter((r): r is typeof r & { error: string } => Boolean(r.error))
      .map((r) => ({ road: r.road, error: r.error })),
  };
}
