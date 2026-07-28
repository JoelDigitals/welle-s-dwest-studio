import { useEffect, useState } from "react";
import { PhoneCall, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useHotline, type HotlineReport } from "@/lib/use-hotline";
import { manualItem } from "@/lib/use-radio-engine";
import { speakDuration } from "@/lib/planner";
import type { PlanItem } from "@/lib/broadcast-types";

const TYPE_LABEL: Record<HotlineReport["type"], string> = {
  verkehr: "Verkehr",
  blitzer: "Blitzer",
  wetter: "Wetter",
  gruss: "Gruß",
  musikwunsch: "Musikwunsch",
  lob_kritik: "Lob & Kritik",
  sonstiges: "Sonstiges",
};

function toText(list: HotlineReport[]) {
  const traffic = list.filter((r) => r.type === "verkehr");
  const speed = list.filter((r) => r.type === "blitzer");
  const parts: string[] = [];
  if (traffic.length)
    parts.push(
      `Gemeldet von unseren Hörerinnen und Hörern: ${traffic
        .map((r) => `${r.road ? `${r.road}, ` : ""}${r.place}: ${r.message}`)
        .join(" ")}`,
    );
  if (speed.length)
    parts.push(
      `Und die Blitzer-Meldungen: ${speed
        .map((r) => `${r.road ? `${r.road}, ` : ""}${r.place}: ${r.message}`)
        .join(" ")}`,
    );
  return `Der Verkehrsservice auf Welle Südwest. ${
    parts.join(" ") || "Aktuell liegen keine Hörermeldungen vor."
  } Vielen Dank für Ihre Meldungen an unsere Hotline.`;
}

export function HotlinePanel({
  playNow,
  cueNext,
}: {
  playNow: (item: PlanItem) => void;
  cueNext: (item: PlanItem) => void;
}) {
  const query = useHotline();
  const items = query.data?.items ?? [];
  const [text, setText] = useState("");
  const [origin, setOrigin] = useState("");
  const updatedAt = query.dataUpdatedAt;
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    setText(toText((query.data?.items ?? []).slice(0, 6)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatedAt]);

  const item = () =>
    manualItem({
      kind: "traffic",
      title: "Verkehr & Blitzer (Hörer-Hotline)",
      subtitle: "Hotline-Meldungen · KI-Stimme",
      text,
      voice: "nova",
      duration: speakDuration(text),
    });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="display flex items-center gap-2 text-xl">
            <PhoneCall className="size-5 text-primary" /> Hörer-Hotline ({items.length})
          </h3>
          <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Meldeformular für Hörer:{" "}
          <a className="text-primary underline" href="/hotline" target="_blank" rel="noreferrer">
            {origin}/hotline
          </a>
        </p>
        <div className="max-h-[24rem] space-y-1.5 overflow-y-auto pr-1">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground">Noch keine Meldungen eingegangen.</p>
          )}
          {items.map((r) => (
            <div key={r.id} className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                {TYPE_LABEL[r.type] ?? r.type} · {r.region}
                {r.road ? ` · ${r.road}` : ""}
                {r.caller ? ` · ${r.caller}` : ""}
              </p>
              {r.place && <p className="text-sm font-semibold">{r.place}</p>}
              <p className="text-sm text-muted-foreground">{r.message}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="panel space-y-3 p-5">
        <h3 className="display text-xl">Hotline-Meldungen senden</h3>
        <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex gap-2">
          <Button disabled={!text.trim()} onClick={() => playNow(item())}>
            Sofort senden
          </Button>
          <Button variant="secondary" disabled={!text.trim()} onClick={() => cueNext(item())}>
            Als Nächstes
          </Button>
        </div>
      </section>
    </div>
  );
}
