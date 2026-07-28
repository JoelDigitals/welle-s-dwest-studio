import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatClock } from "@/lib/radio-data";
import type { PlanItem } from "@/lib/broadcast-types";

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

/** Vorhören und Freigeben von KI-Moderationen, Werbung und Nachrichten. */
export function ApprovalPanel({
  plan,
  approvalRequired,
  setApprovalRequired,
  approve,
  approveAll,
}: {
  plan: PlanItem[];
  approvalRequired: boolean;
  setApprovalRequired: (v: boolean) => void;
  approve: (id: string) => void;
  approveAll: () => void;
}) {
  const pending = plan.filter((i) => i.needsApproval && !i.approved).slice(0, 25);

  return (
    <section className="panel space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="display flex items-center gap-2 text-xl">
          <ShieldCheck className="size-5 text-primary" /> Vorhören & Freigabe
        </h3>
        <div className="flex items-center gap-3">
          <Label htmlFor="apq" className="text-xs uppercase tracking-widest">
            Freigabe nötig
          </Label>
          <Switch id="apq" checked={approvalRequired} onCheckedChange={setApprovalRequired} />
          <Button size="sm" variant="secondary" onClick={approveAll} disabled={!pending.length}>
            Alle freigeben
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Bei aktiver Freigabe wartet die Sendung, bis KI-Moderationen, Spots und Nachrichten geprüft
        sind.
      </p>

      {pending.length === 0 ? (
        <p className="rounded-lg border border-border bg-secondary/40 px-3 py-6 text-center text-sm text-muted-foreground">
          Nichts offen – alles freigegeben.
        </p>
      ) : (
        <ul className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
          {pending.map((item) => (
            <li
              key={item.uid}
              className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {clock(item.plannedAt)} · {item.subtitle} · {formatClock(item.duration)}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => approve(item.uid)}
                  disabled={item.status !== "ready"}
                >
                  {item.status === "ready" ? (
                    <CheckCircle2 className="mr-1 size-4" />
                  ) : (
                    <Loader2 className="mr-1 size-4 animate-spin" />
                  )}
                  Freigeben
                </Button>
              </div>
              {item.text && (
                <p className="max-h-24 overflow-y-auto text-xs leading-relaxed text-muted-foreground">
                  {item.text}
                </p>
              )}
              {item.audioUrl && (
                <audio controls src={item.audioUrl} className="w-full" preload="none" />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
