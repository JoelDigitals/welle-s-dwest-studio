import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SHOWS } from "@/lib/radio-config";

function useDailyThemes() {
  return useQuery({
    queryKey: ["daily-theme"],
    queryFn: async () => {
      const res = await fetch("/api/daily-theme");
      if (!res.ok) throw new Error(`Tagesthemen nicht erreichbar (${res.status})`);
      return (await res.json()) as { items: Record<string, string> };
    },
    refetchInterval: 60_000,
  });
}

/** Tagesthema je Sendung: normalerweise wählt die KI es aus den Top-Nachrichten des Tages (siehe
 *  ensureDailyThemes in station-engine.ts), die Redaktion kann es hier aber jederzeit selbst
 *  festlegen oder überschreiben - z. B. für ein großes lokales Ereignis (Nutzer-Feedback-Beispiel:
 *  ein SVE-Sieg, über den der ganze Tag berichtet werden soll), das die KI mangels Kontingent
 *  gerade nicht selbst erkennen kann. */
export function DailyThemePanel() {
  const query = useDailyThemes();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = query.data?.items ?? {};

  const save = async (showId: string) => {
    const topic = (drafts[showId] ?? "").trim();
    if (topic.length < 3) {
      setError("Bitte mindestens 3 Zeichen eingeben.");
      return;
    }
    setError(null);
    setSavingId(showId);
    try {
      const res = await fetch("/api/daily-theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showId, topic }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? `Fehler (${res.status})`);
      setDrafts((d) => ({ ...d, [showId]: "" }));
      await queryClient.invalidateQueries({ queryKey: ["daily-theme"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="panel space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="display flex items-center gap-2 text-xl">
          <Lightbulb className="size-5 text-primary" /> Tagesthema je Sendung
        </h3>
        <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
          <RefreshCw className="size-4" />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Normalerweise wählt die KI das Tagesthema aus den aktuellen Top-Nachrichten. Hier können Sie
        es für jede Sendung selbst festlegen oder überschreiben – die Änderung gilt sofort für den
        Rest des heutigen Sendetags.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="space-y-2">
        {SHOWS.map((show) => (
          <div
            key={show.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/40 p-3"
          >
            <div className="min-w-[10rem] flex-1">
              <p className="text-sm font-semibold">{show.title}</p>
              <p className="text-xs text-muted-foreground">
                {items[show.id] ? `Heute: ${items[show.id]}` : "Noch kein Tagesthema für heute."}
              </p>
            </div>
            <Input
              className="min-w-[14rem] flex-[2]"
              placeholder="Eigenes Tagesthema eintragen …"
              value={drafts[show.id] ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [show.id]: e.target.value }))}
            />
            <Button
              size="sm"
              disabled={savingId === show.id || (drafts[show.id] ?? "").trim().length < 3}
              onClick={() => void save(show.id)}
            >
              Festlegen
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
