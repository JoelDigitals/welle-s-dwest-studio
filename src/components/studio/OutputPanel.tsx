import { useEffect, useState } from "react";
import { Radio, Share2, Signal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Icecast = { server: string; mount: string; user: string; password: string; streamUrl: string };
type OnAirItem = { title: string; subtitle: string } | null;

const EMPTY: Icecast = {
  server: "https://stream.example.org:8000",
  mount: "/welle-suedwest",
  user: "source",
  password: "",
  streamUrl: "",
};

export function OutputPanel({ current }: { current: OnAirItem }) {
  const [origin, setOrigin] = useState("");
  const [cfg, setCfg] = useState<Icecast>(EMPTY);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    const raw = localStorage.getItem("ws-icecast");
    if (raw) {
      try {
        setCfg({ ...EMPTY, ...(JSON.parse(raw) as Partial<Icecast>) });
      } catch {
        /* ungültige Konfiguration ignorieren */
      }
    }
  }, []);

  const update = (patch: Partial<Icecast>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    localStorage.setItem("ws-icecast", JSON.stringify(next));
  };

  async function pushMetadata() {
    setStatus("Sende Metadaten…");
    try {
      const res = await fetch("/api/icecast-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server: cfg.server,
          mount: cfg.mount,
          user: cfg.user,
          password: cfg.password,
          title: `${current?.title ?? "Welle Südwest"}${current?.subtitle ? ` – ${current.subtitle}` : ""}`,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; status?: number };
      setStatus(
        data.ok ? "Titel im Radionetz aktualisiert." : (data.error ?? `Fehler ${data.status}`),
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Übertragung fehlgeschlagen");
    }
  }

  async function publishStreamUrl() {
    await fetch("/api/public/nowplaying", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamUrl: cfg.streamUrl || null }),
    }).catch(() => undefined);
    setStatus("Stream-URL für den Webplayer gespeichert.");
  }

  const embed = `<iframe src="${origin}/player" width="100%" height="160" frameborder="0" allow="autoplay" title="Welle Südwest Webplayer"></iframe>`;
  const meta = `${origin}/api/public/nowplaying`;
  const liveStreamUrl = `${origin}/live-stream`;

  async function useOwnFreeStream() {
    update({ streamUrl: liveStreamUrl });
    await fetch("/api/public/nowplaying", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamUrl: liveStreamUrl }),
    }).catch(() => undefined);
    setStatus("Eigener kostenloser Stream ist jetzt die Stream-URL für den Webplayer.");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel space-y-3 p-5">
        <h3 className="display flex items-center gap-2 text-xl">
          <Share2 className="size-5 text-primary" /> Webplayer zum Einbinden
        </h3>
        <p className="text-sm text-muted-foreground">
          Diesen Code auf jeder Website einfügen – der Player zeigt das laufende Programm.
        </p>
        <Textarea readOnly rows={4} value={embed} className="font-mono text-xs" />
        <div className="flex gap-2">
          <Button onClick={() => void navigator.clipboard.writeText(embed)}>
            Embed-Code kopieren
          </Button>
          <Button variant="secondary" asChild>
            <a href="/player" target="_blank" rel="noreferrer">
              Player öffnen
            </a>
          </Button>
        </div>
      </section>

      <section className="panel space-y-3 p-5 lg:col-span-2">
        <h3 className="display flex items-center gap-2 text-xl">
          <Radio className="size-5 text-primary" /> Eigener kostenloser Dauer-Stream
        </h3>
        <p className="text-sm text-muted-foreground">
          Kein externer Streaming-Anbieter nötig: Dieses Studio liefert selbst einen durchgehenden
          MP3-Stream, live aus der Sende-Engine erzeugt. Direkt abspielbar in VLC, einer Radio-App
          oder als Quelle für einen echten Icecast-Server.
        </p>
        <Textarea readOnly rows={1} value={liveStreamUrl} className="font-mono text-xs" />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void navigator.clipboard.writeText(liveStreamUrl)}>
            URL kopieren
          </Button>
          <Button variant="secondary" onClick={() => void useOwnFreeStream()}>
            Als Webplayer-Quelle verwenden
          </Button>
        </div>
      </section>

      <section className="panel space-y-3 p-5">
        <h3 className="display flex items-center gap-2 text-xl">
          <Radio className="size-5 text-primary" /> Ausspielung ins Radionetz
        </h3>
        <p className="text-sm text-muted-foreground">
          Metadaten-Endpunkt für Encoder (Icecast/Shoutcast, RDS, DAB+ Dynamic Label):
        </p>
        <Textarea readOnly rows={2} value={meta} className="font-mono text-xs" />
        <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(meta)}>
          URL kopieren
        </Button>
        <div className="rounded-lg border border-border bg-secondary/40 p-3 text-sm">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Now Playing</p>
          <p className="font-semibold">{current?.title ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{current?.subtitle ?? ""}</p>
        </div>
      </section>

      <section className="panel space-y-3 p-5 lg:col-span-2">
        <h3 className="display flex items-center gap-2 text-xl">
          <Signal className="size-5 text-primary" /> Icecast / SHOUTcast
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Server-URL</Label>
            <Input value={cfg.server} onChange={(e) => update({ server: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Mountpoint</Label>
            <Input value={cfg.mount} onChange={(e) => update({ mount: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Benutzer</Label>
            <Input value={cfg.user} onChange={(e) => update({ user: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Passwort</Label>
            <Input
              type="password"
              value={cfg.password}
              onChange={(e) => update({ password: e.target.value })}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">
              Öffentliche Stream-URL (wird im Webplayer abgespielt)
            </Label>
            <Input
              placeholder="https://stream.example.org:8000/welle-suedwest"
              value={cfg.streamUrl}
              onChange={(e) => update({ streamUrl: e.target.value })}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void publishStreamUrl()}>Stream-URL veröffentlichen</Button>
          <Button variant="secondary" disabled={!cfg.password} onClick={() => void pushMetadata()}>
            Titel ans Radionetz senden
          </Button>
        </div>
        {status && <p className="text-sm text-muted-foreground">{status}</p>}
        <p className="text-xs text-muted-foreground">
          Das Sendesignal selbst wird von einem Encoder (z. B. BUTT, Liquidsoap, RadioBOSS) auf
          diesen Mountpoint gesendet – Titel- und Sendungsinfos liefert dieses Studio automatisch
          dazu.
        </p>
      </section>
    </div>
  );
}
