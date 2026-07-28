import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TITLE = "Hörer-Hotline – Welle Südwest";
const DESCRIPTION =
  "Verkehr, Blitzer, Grüße, Musikwünsche oder Feedback – melden Sie sich direkt bei der Redaktion von Welle Südwest.";

const TYPE_OPTIONS: Array<{ value: string; label: string; needsPlace: boolean }> = [
  { value: "verkehr", label: "Verkehr (Stau, Unfall, Sperrung)", needsPlace: true },
  { value: "blitzer", label: "Blitzer", needsPlace: true },
  { value: "wetter", label: "Wetterbeobachtung", needsPlace: false },
  { value: "gruss", label: "Gruß / Musikwidmung", needsPlace: false },
  { value: "musikwunsch", label: "Musikwunsch", needsPlace: false },
  { value: "lob_kritik", label: "Lob & Kritik", needsPlace: false },
  { value: "sonstiges", label: "Sonstiges", needsPlace: false },
];

export const Route = createFileRoute("/hotline")({
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
  component: Hotline,
});

function Hotline() {
  const [type, setType] = useState("verkehr");
  const [region, setRegion] = useState("Saarland");
  const [place, setPlace] = useState("");
  const [road, setRoad] = useState("");
  const [message, setMessage] = useState("");
  const [caller, setCaller] = useState("");
  const [contact, setContact] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const needsPlace = TYPE_OPTIONS.find((t) => t.value === type)?.needsPlace ?? false;

  async function submit() {
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/public/hotline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, region, place, road, message, caller, contact }),
      });
      if (!res.ok) {
        const info = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(info?.error ?? "Meldung konnte nicht gesendet werden.");
      }
      setStatus("done");
      setPlace("");
      setRoad("");
      setMessage("");
      setContact("");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <header className="flex items-center gap-3">
        <PhoneCall className="size-7 text-primary" />
        <div>
          <h1 className="display text-3xl leading-none">Hörer-Hotline</h1>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Verkehr, Blitzer, Grüße, Musikwünsche & Feedback
          </p>
        </div>
      </header>

      <section className="panel space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Art</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">
              Region
            </Label>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Saarland">Saarland</SelectItem>
                <SelectItem value="Rheinland-Pfalz">Rheinland-Pfalz</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {needsPlace && (
          <>
            <Input
              placeholder="Ort / Abschnitt (z. B. Saarbrücken-Burbach)"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
            />
            <Input
              placeholder="Straße (z. B. A620, B51)"
              value={road}
              onChange={(e) => setRoad(e.target.value)}
            />
          </>
        )}
        <Textarea
          rows={4}
          placeholder={
            needsPlace
              ? "Was ist los? (z. B. Blitzer in Fahrtrichtung Saarlouis, rechte Spur)"
              : "Ihre Nachricht an die Redaktion…"
          }
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="Ihr Name (optional)"
            value={caller}
            onChange={(e) => setCaller(e.target.value)}
          />
          <Input
            placeholder="Kontakt für Rückfragen (optional, nie on air)"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
        </div>

        <Button
          disabled={status === "sending" || (needsPlace && !place.trim()) || !message.trim()}
          onClick={() => void submit()}
        >
          {status === "sending" ? "Wird gesendet…" : "Meldung an die Redaktion senden"}
        </Button>

        {status === "done" && (
          <p className="text-sm text-signal">Danke! Ihre Meldung liegt in der Redaktion vor.</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">
          Bitte melden Sie nur, wenn Sie nicht selbst am Steuer sitzen.
        </p>
      </section>
    </main>
  );
}
