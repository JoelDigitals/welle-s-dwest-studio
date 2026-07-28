import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Health = {
  ok: boolean;
  status: number;
  latency: number;
  bitrate?: number | null;
  listeners?: number | null;
  name?: string | null;
  checkedAt: string;
  error?: string | null;
};

const STORE = "ws-streamurl";

/** Überwacht den Icecast-/SHOUTcast-Ausgang inkl. Alarm und Auto-Neuversuch. */
export function StreamHealth({
  onLog,
}: {
  onLog?: (level: "info" | "warn" | "error", m: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [autoRestart, setAutoRestart] = useState(true);
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);
  const failures = useRef(0);

  useEffect(() => {
    setUrl(localStorage.getItem(STORE) ?? "");
  }, []);

  const check = useCallback(async () => {
    if (!url) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/streamhealth?url=${encodeURIComponent(url)}`);
      const data = (await res.json()) as Health;
      setHealth(data);
      if (data.ok) {
        if (failures.current > 0) onLog?.("info", "Stream wieder erreichbar.");
        failures.current = 0;
      } else {
        failures.current += 1;
        onLog?.("error", `Stream-Alarm (${failures.current}): ${data.error ?? "keine Antwort"}`);
        if (autoRestart && failures.current < 5) {
          setTimeout(() => void check(), 5000);
          onLog?.("warn", "Automatischer Neuversuch in 5 Sekunden…");
        }
      }
    } catch {
      setHealth({
        ok: false,
        status: 0,
        latency: 0,
        checkedAt: new Date().toISOString(),
        error: "Prüfung fehlgeschlagen",
      });
    } finally {
      setChecking(false);
    }
  }, [url, autoRestart, onLog]);

  useEffect(() => {
    if (!url) return;
    localStorage.setItem(STORE, url);
    void check();
    const id = setInterval(() => void check(), 60_000);
    return () => clearInterval(id);
  }, [url, check]);

  return (
    <section className="panel space-y-4 p-5">
      <h3 className="display flex items-center gap-2 text-xl">
        <Activity className="size-5 text-primary" /> Stream-Health
      </h3>
      <div className="space-y-2">
        <Label htmlFor="sh-url" className="text-xs uppercase tracking-widest">
          Stream-URL (Icecast / SHOUTcast)
        </Label>
        <div className="flex gap-2">
          <Input
            id="sh-url"
            placeholder="https://stream.example.de/wellesuedwest.mp3"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button variant="secondary" onClick={() => void check()} disabled={!url || checking}>
            <RefreshCw className={checking ? "size-4 animate-spin" : "size-4"} />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-3 py-2">
        <Label htmlFor="sh-auto" className="text-sm">
          Automatischer Neuversuch bei Ausfall
        </Label>
        <Switch id="sh-auto" checked={autoRestart} onCheckedChange={setAutoRestart} />
      </div>

      {health ? (
        <div
          className={`space-y-1 rounded-lg border px-3 py-3 text-sm ${
            health.ok ? "border-signal/50 bg-signal/10" : "border-destructive/60 bg-destructive/10"
          }`}
        >
          <p className="flex items-center gap-2 font-semibold">
            {health.ok ? (
              <CheckCircle2 className="size-4 text-signal" />
            ) : (
              <AlertTriangle className="size-4 text-destructive" />
            )}
            {health.ok ? "Stream online" : "Stream gestört"}
          </p>
          <p className="text-xs text-muted-foreground">
            HTTP {health.status} · {health.latency} ms
            {health.bitrate ? ` · ${health.bitrate} kbit/s` : ""}
            {health.listeners != null ? ` · ${health.listeners} Hörer` : ""}
          </p>
          {health.error && <p className="text-xs text-destructive">{health.error}</p>}
          <p className="text-xs text-muted-foreground">
            Zuletzt geprüft: {new Date(health.checkedAt).toLocaleTimeString("de-DE")}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Stream-URL eintragen – danach wird der Ausgang jede Minute automatisch geprüft.
        </p>
      )}
    </section>
  );
}
