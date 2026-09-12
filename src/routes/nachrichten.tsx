import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Newspaper, Search, X } from "lucide-react";

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

type NewsPage = { items: Article[]; page: number; totalPages: number };

const PAGE_SIZE = 16;

/** Paginiert statt alles auf einmal zu laden – Artikel bleiben dauerhaft gespeichert (siehe
 *  news-articles-store.ts), die Liste kann also mit der Zeit lang werden. */
function useNewsPage(page: number, query: string) {
  const [data, setData] = useState<NewsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const load = async () => {
      try {
        const q = query.trim() ? `&q=${encodeURIComponent(query.trim())}` : "";
        const res = await fetch(`/api/public/news-page?page=${page}&pageSize=${PAGE_SIZE}${q}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as NewsPage;
        if (active) {
          setData(json);
          setError(null);
        }
      } catch {
        if (active) setError("Nachrichten gerade nicht erreichbar – bitte gleich nochmal versuchen.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    // Nur die aktuell sichtbare Seite pollen, keine Endlos-Liste im Hintergrund neu laden.
    const t = setInterval(load, 5 * 60_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [page, query]);

  return { data, error, loading };
}

function Nachrichten() {
  const [page, setPage] = useState(1);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, loading } = useNewsPage(page, query);
  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  const runSearch = () => {
    setPage(1);
    setQuery(queryInput.trim());
  };
  const clearSearch = () => {
    setQueryInput("");
    setQuery("");
    setPage(1);
  };

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

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Nachrichten durchsuchen …"
            className="w-full rounded-full border border-border bg-secondary/40 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        {query && (
          <button
            type="button"
            onClick={clearSearch}
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-2 text-xs font-medium"
          >
            <X className="size-3.5" /> Zurücksetzen
          </button>
        )}
        <button type="submit" className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">
          Suchen
        </button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-secondary/40" />
          ))}
        </div>
      )}
      {!loading && items.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">
          {query ? `Keine Nachrichten zu „${query}“ gefunden.` : "Aktuell liegen keine Meldungen vor."}
        </p>
      )}

      <div className="space-y-3">
        {items.map((a) => (
          <article key={a.id} className="panel space-y-2 p-5">
            <p className="text-xs uppercase tracking-widest text-primary">{a.region}</p>
            <h2 className="display text-xl">{a.headline}</h2>
            <div className="space-y-2 text-sm leading-relaxed text-foreground/90">
              {a.article
                .split("\n")
                .filter(Boolean)
                .map((p, i) => (
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
      </div>

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          >
            <ChevronLeft className="size-4" /> Neuer
          </button>
          <span className="text-xs text-muted-foreground">
            Seite {page} von {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          >
            Älter <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </main>
  );
}
