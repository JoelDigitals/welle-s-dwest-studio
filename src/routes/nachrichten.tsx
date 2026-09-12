import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Newspaper, RefreshCw } from "lucide-react";

const TITLE = "Nachrichten – Welle Südwest";
const DESCRIPTION =
  "Aktuelle Nachrichten für Saarland, Rheinland-Pfalz, Deutschland und die Welt – ausführlich zum Nachlesen, von Welle Südwest.";

export const Route = createFileRoute("/nachrichten")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Nachrichten,
});

type Region = "Saarland" | "Rheinland-Pfalz" | "Deutschland" | "Welt";

type Article = {
  id: string;
  region: Region;
  headline: string;
  source: string;
  link: string | null;
  publishedAt: string | null;
  article: string;
};

const REGION_ORDER: Region[] = ["Saarland", "Rheinland-Pfalz", "Deutschland", "Welt"];

function useNewsPage() {
  const [items, setItems] = useState<Article[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/public/news-page");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { items: Article[] };
        if (active) {
          setItems(json.items);
          setError(null);
        }
      } catch {
        if (active) setError("Nachrichten gerade nicht erreichbar – bitte gleich nochmal versuchen.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const t = setInterval(load, 5 * 60_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  return { items, error, loading };
}

function Nachrichten() {
  const { items, error, loading } = useNewsPage();
  const byRegion = REGION_ORDER.map((region) => ({
    region,
    items: (items ?? []).filter((i) => i.region === region),
  })).filter((g) => g.items.length > 0);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header className="flex items-center gap-3">
        <Newspaper className="size-7 text-primary" />
        <div>
          <h1 className="display text-3xl leading-none">Nachrichten</h1>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Saarland, Rheinland-Pfalz, Deutschland & Welt
          </p>
        </div>
      </header>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-secondary/40" />
          ))}
        </div>
      )}
      {!loading && (items?.length ?? 0) === 0 && !error && (
        <p className="text-sm text-muted-foreground">Aktuell liegen keine Meldungen vor.</p>
      )}

      {byRegion.map(({ region, items: regionItems }) => (
        <section key={region} className="space-y-3">
          <h2 className="display flex items-center gap-2 text-lg text-primary">
            <RefreshCw className="size-4" /> {region}
          </h2>
          {regionItems.map((a) => (
            <article key={a.id} className="panel space-y-2 p-5">
              <h3 className="display text-xl">{a.headline}</h3>
              <div className="space-y-2 text-sm leading-relaxed text-foreground/90">
                {a.article.split("\n").filter(Boolean).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Quelle: {a.source}
                {a.link && (
                  <>
                    {" · "}
                    <a
                      className="text-primary underline"
                      href={a.link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Originalartikel
                    </a>
                  </>
                )}
              </p>
            </article>
          ))}
        </section>
      ))}
    </main>
  );
}
