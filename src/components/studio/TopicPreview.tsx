import { CheckCircle2, Circle, Sparkles, Shuffle, Info } from "lucide-react";
import type { PlanItem } from "@/lib/broadcast-types";

const LABELS: Record<string, string> = {
  kultur: "Kultur",
  netz: "Netz",
  witziges: "Witziges",
  service: "Service",
  region: "Region",
  musik: "Musik",
  hoerer: "Hörer",
};

const CHECK = ["kultur", "netz", "witziges", "service"];

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

/** Zeigt vor jeder Moderation, welche Rubriken abgedeckt sind und welches Thema kommt. */
export function TopicPreview({ plan, limit = 5 }: { plan: PlanItem[]; limit?: number }) {
  const moderations = plan.filter((i) => i.kind === "moderation" && i.topicCat).slice(0, limit);

  return (
    <section className="panel space-y-4 p-5">
      <h3 className="display flex items-center gap-2 text-xl">
        <Sparkles className="size-5 text-primary" /> Themen-Vorschau
      </h3>
      <p className="text-sm text-muted-foreground">
        Regel: Vor jeder Moderation prüft der Planer die Checkliste Kultur, Netz, Witziges und
        Service. Passt das Sendungsthema zu einer noch offenen Rubrik, wird es genommen – sonst
        wählt der Planer automatisch ein Ersatzthema aus der offenen Rubrik. Sind alle vier
        abgehakt, startet die Checkliste neu.
      </p>

      {moderations.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Noch keine Moderation im aktuellen Plan – bitte neu planen.
        </p>
      )}

      <ul className="space-y-2">
        {moderations.map((item) => {
          const covered = new Set(item.topicCovered ?? []);
          return (
            <li key={item.uid} className="rounded-lg border border-border bg-secondary/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">
                  {clock(item.plannedAt)} · {item.subtitle}
                </p>
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-widest text-muted-foreground">
                  {LABELS[item.topicCat ?? ""] ?? item.topicCat}
                </span>
              </div>
              <p
                className={`mt-1 flex items-start gap-1 text-xs ${
                  item.topicFallback ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {item.topicFallback ? (
                  <Shuffle className="mt-0.5 size-3 shrink-0" />
                ) : (
                  <Info className="mt-0.5 size-3 shrink-0" />
                )}
                <span>
                  {item.topicFallback
                    ? `Ersatzthema „${item.subtitle}" – ${item.topicRule ?? "offene Rubrik wurde aufgefüllt."}`
                    : (item.topicRule ?? "Sendungsthema passt zur offenen Rubrik.")}
                </span>
              </p>
              {(item.topicOpen?.length ?? 0) > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Danach noch offen:{" "}
                  {(item.topicOpen ?? []).map((c) => LABELS[c] ?? c).join(", ")}
                </p>
              )}
              <ul className="mt-2 flex flex-wrap gap-3 text-xs">
                {CHECK.map((c) => {
                  const done = covered.has(c);
                  return (
                    <li
                      key={c}
                      className={`flex items-center gap-1 ${done ? "text-signal" : "text-muted-foreground"}`}
                    >
                      {done ? <CheckCircle2 className="size-3.5" /> : <Circle className="size-3.5" />}
                      {LABELS[c]}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
