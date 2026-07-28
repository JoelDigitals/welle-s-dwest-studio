import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const TITLE = "Werbung schalten – Welle Südwest";
const DESCRIPTION =
  "Bewerben Sie Ihren Spot bei Welle Südwest – die Redaktion prüft und gibt frei, bevor er auf Sendung geht.";

export const Route = createFileRoute("/werbung")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Werbung,
});

function Werbung() {
  const [advertiser, setAdvertiser] = useState("");
  const [contact, setContact] = useState("");
  const [text, setText] = useState("");
  const [perHour, setPerHour] = useState(1);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/public/ad-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ advertiser, contact, text, perHour }),
      });
      if (!res.ok) {
        const info = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(info?.error ?? "Bewerbung konnte nicht gesendet werden.");
      }
      setStatus("done");
      setText("");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <header className="flex items-center gap-3">
        <Megaphone className="size-7 text-primary" />
        <div>
          <h1 className="display text-3xl leading-none">Werbung schalten</h1>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Bewerbung bei Welle Südwest
          </p>
        </div>
      </header>

      <section className="panel space-y-4 p-5">
        <p className="text-sm text-muted-foreground">
          Es läuft keine Werbung automatisch. Ihre Bewerbung geht direkt an die Redaktion, die prüft
          und freigibt – erst danach nimmt der Autopilot den Spot in den Sendeplan auf.
        </p>
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground">
            Firma / Werbekunde
          </Label>
          <Input
            value={advertiser}
            onChange={(e) => setAdvertiser(e.target.value)}
            placeholder="Autohaus Kern, Neunkirchen"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground">Kontakt</Label>
          <Input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="E-Mail oder Telefon"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground">
            Spot-Text
          </Label>
          <Textarea
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Werbetext, den unsere KI-Stimme sprechen soll…"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground">
            Gewünschte Spots pro Stunde: {perHour}
          </Label>
          <Input
            type="number"
            min={1}
            max={4}
            value={perHour}
            onChange={(e) => setPerHour(Math.min(4, Math.max(1, Number(e.target.value) || 1)))}
          />
        </div>

        <Button
          disabled={status === "sending" || !advertiser.trim() || !text.trim()}
          onClick={() => void submit()}
        >
          {status === "sending" ? "Wird gesendet…" : "Bewerbung einreichen"}
        </Button>

        {status === "done" && (
          <p className="text-sm text-signal">
            Danke! Ihre Bewerbung liegt der Redaktion zur Prüfung vor.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>
    </main>
  );
}
