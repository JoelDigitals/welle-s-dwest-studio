import { useEffect, useState } from "react";
import { Megaphone, Check, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AdCampaign } from "@/lib/broadcast-types";

const STATUS_LABEL: Record<AdCampaign["status"], string> = {
  eingereicht: "Eingereicht",
  geprueft: "In Prüfung",
  freigegeben: "Freigegeben – wird gesendet",
  abgelehnt: "Abgelehnt",
};

export function AdRequestsPanel({
  campaigns,
  add,
  setStatus,
  remove,
}: {
  campaigns: AdCampaign[];
  add: (c: Omit<AdCampaign, "id" | "createdAt" | "status">) => void;
  setStatus: (id: string, status: AdCampaign["status"]) => void;
  remove: (id: string) => void;
}) {
  const [advertiser, setAdvertiser] = useState("");
  const [contact, setContact] = useState("");
  const [text, setText] = useState("");
  const [perHour, setPerHour] = useState(1);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const submit = () => {
    if (!advertiser.trim() || !text.trim()) return;
    add({ advertiser: advertiser.trim(), contact: contact.trim(), text: text.trim(), perHour });
    setAdvertiser("");
    setContact("");
    setText("");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel space-y-4 p-5">
        <h3 className="display flex items-center gap-2 text-xl">
          <Megaphone className="size-5 text-primary" /> Werbung bewerben
        </h3>
        <p className="text-sm text-muted-foreground">
          Es läuft keine Werbung automatisch. Firmen bewerben sich hier, die Redaktion prüft und
          gibt frei – erst danach nimmt der Autopilot den Spot in den Sendeplan auf.
        </p>
        <p className="text-sm text-muted-foreground">
          Bewerbungsformular für Kund:innen:{" "}
          <a className="text-primary underline" href="/werbung" target="_blank" rel="noreferrer">
            {origin}/werbung
          </a>
        </p>
        <div className="space-y-2">
          <Label>Firma / Werbekunde</Label>
          <Input
            value={advertiser}
            onChange={(e) => setAdvertiser(e.target.value)}
            placeholder="Autohaus Kern, Neunkirchen"
          />
        </div>
        <div className="space-y-2">
          <Label>Kontakt</Label>
          <Input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="E-Mail oder Telefon"
          />
        </div>
        <div className="space-y-2">
          <Label>Spot-Text</Label>
          <Textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Werbetext…"
          />
        </div>
        <div className="space-y-2">
          <Label>Gewünschte Spots pro Stunde: {perHour}</Label>
          <Input
            type="number"
            min={1}
            max={4}
            value={perHour}
            onChange={(e) => setPerHour(Math.min(4, Math.max(1, Number(e.target.value) || 1)))}
          />
        </div>
        <Button disabled={!advertiser.trim() || !text.trim()} onClick={submit}>
          Bewerbung einreichen
        </Button>
      </section>

      <section className="panel space-y-3 p-5">
        <h3 className="display text-xl">Bewerbungen ({campaigns.length})</h3>
        {campaigns.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Keine Bewerbungen – aktuell wird keine Werbung gesendet.
          </p>
        )}
        {campaigns.map((c) => (
          <div key={c.id} className="rounded-lg border border-border bg-secondary/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{c.advertiser}</p>
                <p className="text-xs text-muted-foreground">
                  {STATUS_LABEL[c.status]} · {c.perHour} Spot(s)/h {c.contact && `· ${c.contact}`}
                </p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => remove(c.id)} aria-label="Löschen">
                <Trash2 className="size-4" />
              </Button>
            </div>
            <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{c.text}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setStatus(c.id, "geprueft")}>
                Prüfen
              </Button>
              <Button size="sm" onClick={() => setStatus(c.id, "freigegeben")}>
                <Check className="size-4" /> Freigeben
              </Button>
              <Button size="sm" variant="outline" onClick={() => setStatus(c.id, "abgelehnt")}>
                <X className="size-4" /> Ablehnen
              </Button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
