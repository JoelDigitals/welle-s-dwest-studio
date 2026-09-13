import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, TrafficCone, Radar, AlertTriangle, Ban, Construction } from "lucide-react";

const TITLE = "Staus & Blitzer – Welle Südwest";
const DESCRIPTION =
  "Aktuelle Staus, Sperrungen und Blitzer-Meldungen für Saarland und Rheinland-Pfalz, live von Welle Südwest.";

export const Route = createFileRoute("/verkehr")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Verkehr,
});

type Category = "unfall" | "sperrung" | "baustelle" | "stau";

type TrafficItem = {
  id: string;
  road: string;
  region: "Saarland" | "Rheinland-Pfalz";
  headline: string;
  message: string;
  since: string | null;
  category: Category;
  urgent: boolean;
};

type HotlineItem = {
  id: string;
  region: "Saarland" | "Rheinland-Pfalz";
  place: string | null;
  road: string | null;
  message: string | null;
  createdAt: number;
};

/** Hörer-Verkehrsmeldungen (nicht Blitzer) sind zusätzlich klassifiziert wie der offizielle Feed. */
type HotlineTrafficItem = HotlineItem & { category: Category; urgent: boolean };

const CATEGORY_LABEL: Record<Category, string> = {
  unfall: "Unfall",
  sperrung: "Sperrung",
  baustelle: "Baustelle",
  stau: "Stau",
};

const CATEGORY_ICON: Record<Category, typeof AlertTriangle> = {
  unfall: AlertTriangle,
  sperrung: Ban,
  baustelle: Construction,
  stau: TrafficCone,
};

/** Unfälle/Sperrungen deutlich hervorgehoben (rot), Baustelle gedämpfter (Bernstein), gewöhnlicher
 *  Stau neutral – damit sicherheitsrelevante Meldungen auf den ersten Blick auffallen, statt in
 *  einer unsortierten, gleich aussehenden Liste unterzugehen. */
function CategoryBadge({ category }: { category: Category }) {
  const Icon = CATEGORY_ICON[category];
  const style =
    category === "unfall" || category === "sperrung"
      ? "border-destructive/50 bg-destructive/10 text-destructive"
      : category === "baustelle"
        ? "border-signal/50 bg-signal/10 text-signal"
        : "border-border bg-secondary/40 text-muted-foreground";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-widest ${style}`}
    >
      <Icon className="size-3" /> {CATEGORY_LABEL[category]}
    </span>
  );
}

type Overview = {
  traffic: TrafficItem[];
  hotlineTraffic: HotlineTrafficItem[];
  blitzer: HotlineItem[];
  updatedAt: number;
};

function timeAgo(ms: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  return `vor ${hours} Std.`;
}

function useTrafficOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/public/traffic-overview");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Overview;
        if (active) {
          setData(json);
          setError(null);
        }
      } catch {
        if (active) setError("Daten gerade nicht erreichbar – nächster Versuch in Kürze.");
      }
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  return { data, error };
}

function RegionBadge({ region }: { region: "Saarland" | "Rheinland-Pfalz" }) {
  return (
    <span className="shrink-0 rounded-md border border-border bg-secondary/40 px-2 py-0.5 text-xs uppercase tracking-widest text-muted-foreground">
      {region}
    </span>
  );
}

function Verkehr() {
  const { data, error } = useTrafficOverview();

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header className="flex items-center gap-3">
        <TrafficCone className="size-7 text-primary" />
        <div>
          <h1 className="display text-3xl leading-none">Staus & Blitzer</h1>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Saarland & Rheinland-Pfalz · live von Welle Südwest
          </p>
        </div>
      </header>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="panel space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="display flex items-center gap-2 text-xl">
            <TrafficCone className="size-5 text-primary" /> Staus & Sperrungen
          </h2>
          {data && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <RefreshCw className="size-3" /> {timeAgo(data.updatedAt)}
            </span>
          )}
        </div>
        <div className="space-y-2">
          {data && data.traffic.length === 0 && data.hotlineTraffic.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Aktuell keine größeren Behinderungen gemeldet.
            </p>
          )}
          {!data &&
            !error &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-secondary/40" />
            ))}
          {/* Offizielle Meldungen und Hörer-Verkehrsmeldungen zusammen in EINER Liste, nach
              Dringlichkeit sortiert - keine eigene "Hörer-Hotline"-Sektion mehr, sie sollen genauso
              aussehen und behandelt werden wie die offiziellen Meldungen. */}
          {data &&
            [
              ...data.traffic.map((t) => ({ ...t, kind: "official" as const })),
              ...data.hotlineTraffic.map((h) => ({ ...h, kind: "hotline" as const })),
            ]
              .sort((a, b) => Number(b.urgent) - Number(a.urgent))
              .map((item) => (
                <div
                  key={item.id}
                  className={`rounded-lg border p-3 ${
                    item.urgent
                      ? "border-destructive/40 bg-destructive/5"
                      : "border-border bg-secondary/40"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <CategoryBadge category={item.category} />
                    <RegionBadge region={item.region} />
                    {item.kind === "hotline" && item.place && (
                      <span className="font-semibold">{item.place}</span>
                    )}
                    {item.road && <span className="font-semibold">{item.road}</span>}
                  </div>
                  {item.kind === "official" ? (
                    <>
                      <p className="mt-1 text-sm font-semibold">{item.headline}</p>
                      {item.message &&
                        !item.message.toLowerCase().startsWith(item.headline.toLowerCase().slice(0, 30)) && (
                          <p className="mt-0.5 text-sm text-muted-foreground">{item.message}</p>
                        )}
                    </>
                  ) : (
                    item.message && <p className="mt-1 text-sm">{item.message}</p>
                  )}
                </div>
              ))}
        </div>
      </section>

      <section className="panel space-y-3 p-5">
        <h2 className="display flex items-center gap-2 text-xl">
          <Radar className="size-5 text-primary" /> Blitzer-Meldungen
        </h2>
        <p className="text-xs text-muted-foreground">
          Aus unserer Hörer-Hotline, mit Ort bzw. Ortseingang – ohne exakten Punkt (wie im Radio).
        </p>
        <div className="space-y-2">
          {data?.blitzer.length === 0 && (
            <p className="text-sm text-muted-foreground">Aktuell keine Blitzer-Meldungen.</p>
          )}
          {data?.blitzer.map((b) => (
            <div key={b.id} className="rounded-lg border border-border bg-secondary/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="flex flex-wrap items-center gap-2">
                  <RegionBadge region={b.region} />
                  {b.place && <span className="font-semibold">{b.place}</span>}
                  {b.road && <span className="font-semibold">{b.road}</span>}
                </span>
                <span>{timeAgo(b.createdAt)}</span>
              </div>
              {b.message && <p className="mt-1 text-sm">{b.message}</p>}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Alle Angaben ohne Gewähr. Melden Sie uns Blitzer über unsere{" "}
          <a className="text-primary underline" href="/hotline">
            Hörer-Hotline
          </a>
          .
        </p>
      </section>
    </main>
  );
}
