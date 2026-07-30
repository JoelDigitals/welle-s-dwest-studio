import { useCallback, useEffect, useRef, useState } from "react";
import { Mp3Encoder } from "lamejs";
// Muss vor jeder Mp3Encoder-Nutzung importiert sein – behebt mehrere fehlende globale
// Referenzen im lamejs-Paket selbst (siehe lame-shim.ts für Details).
import "./lame-shim";

/** Sendeintervall der MP3-Chunks zum Server – klein genug für echtes Live-Gefühl, groß genug,
 *  um nicht bei jedem winzigen Encoder-Aufruf einen eigenen HTTP-Request zu feuern. */
const CHUNK_MS = 300;

/**
 * Nimmt das Mikrofon im Browser auf, kodiert es live zu MP3 (lamejs, reines JS – kein Server-
 * Transkodieren nötig) und schickt die fertigen Bytes per POST an /api/mic-stream, von wo die
 * Sende-Engine sie direkt an alle /live-stream-Hörer:innen weiterreicht. Liefert zusätzlich einen
 * einfachen Pegelwert (0..1) für eine VU-Anzeige im Studio (gleiches Muster wie der alte,
 * rein kosmetische VU-Meter in use-radio-engine.ts, hier aber am echten Sende-Signal) sowie
 * sentBytes/lastError, damit im Studio sichtbar ist, ob wirklich Daten rausgehen – ohne das gäbe
 * es keine Rückmeldung, falls z. B. die Berechtigung verweigert wurde oder der Upload fehlschlägt.
 */
export function useMicBroadcast() {
  const [active, setActive] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [level, setLevel] = useState(0);
  const [sentBytes, setSentBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Selbst-Mithören (z. B. über Kopfhörer): standardmäßig aus, da es über Lautsprecher sofort
  // Rückkopplung (Pfeifen) gäbe – bewusst ein Opt-in mit Warnhinweis in der UI.
  const [monitor, setMonitorState] = useState(false);
  // Eingangslautstärke (Vorverstärkung): 1 = unverändert, bis 2 = doppelt so laut – wirkt sowohl
  // auf das tatsächlich gesendete Signal als auch auf die Pegelanzeige, damit der Bediener direkt
  // sieht, wie laut es beim Hörer ankommt.
  const [gain, setGainState] = useState(1);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const monitorNodeRef = useRef<GainNode | null>(null);
  const encoderRef = useRef<Mp3Encoder | null>(null);
  const rafRef = useRef(0);
  const pendingRef = useRef<Int8Array[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref statt nur State, damit der onaudioprocess-Handler (der bei jedem Audio-Block läuft, nicht
  // bei jedem Render) den aktuellen Stumm-Zustand sofort sieht, ohne den Handler neu zu binden.
  const mutedRef = useRef(false);

  const setGain = useCallback((value: number) => {
    setGainState(value);
    if (gainNodeRef.current) gainNodeRef.current.gain.value = value;
  }, []);

  const setMonitor = useCallback((value: boolean) => {
    setMonitorState(value);
    if (monitorNodeRef.current) monitorNodeRef.current.gain.value = value ? 0.8 : 0;
  }, []);

  // Stummschalten sendet keine Bytes mehr (Hörer:innen hören Stille auf dem Mikrofon-Segment),
  // ohne das Mikrofon selbst freizugeben – kein erneutes Berechtigungs-Popup beim Wiedereinschalten
  // nötig, ideal für ein kurzes "kurz husten"/Nebengespräch während einer laufenden Sendung.
  const setMuted = useCallback((value: boolean) => {
    mutedRef.current = value;
    setMutedState(value);
  }, []);

  const sendPending = useCallback(() => {
    const chunks = pendingRef.current;
    if (chunks.length === 0) return;
    pendingRef.current = [];
    let total = 0;
    for (const c of chunks) total += c.length;
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(new Uint8Array(c.buffer, c.byteOffset, c.length), offset);
      offset += c.length;
    }
    void fetch("/api/mic-stream", { method: "POST", body: merged })
      .then((res) => {
        if (!res.ok) {
          setError(
            res.status === 401
              ? "Nicht mehr angemeldet – bitte neu einloggen, das Mikrofon sendet sonst ins Leere."
              : `Senden fehlgeschlagen (${res.status})`,
          );
          return;
        }
        setError(null);
        setSentBytes((n) => n + merged.length);
      })
      .catch(() => setError("Verbindung zum Server unterbrochen – Mikrofon sendet gerade nicht."));
  }, []);

  const stop = useCallback(() => {
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);
    if (encoderRef.current) {
      const last = encoderRef.current.flush();
      if (last.length > 0) pendingRef.current.push(last);
      sendPending();
      encoderRef.current = null;
    }
    processorRef.current?.disconnect();
    processorRef.current = null;
    gainNodeRef.current = null;
    monitorNodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    setActive(false);
    setLevel(0);
    setSentBytes(0);
    mutedRef.current = false;
    setMutedState(false);
  }, [sendPending]);

  const start = useCallback(async () => {
    if (active) return;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Dieser Browser/diese Verbindung erlaubt kein Mikrofon (braucht HTTPS oder localhost).",
      );
      return;
    }
    try {
      const AudioContextCtor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextCtor) throw new Error("Web Audio API (AudioContext) wird nicht unterstützt.");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContextCtor();
      ctxRef.current = ctx;
      // Manche Browser (v. a. Chrome) legen einen AudioContext, der nach einem "await" entsteht,
      // als "suspended" an, weil die Autoplay-Richtlinie die Nutzer:innen-Geste dann nicht mehr
      // erkennt – ohne explizites resume() würde onaudioprocess NIE feuern und es käme kein
      // einziges Byte zustande, obwohl im UI alles "aktiv" aussieht.
      if (ctx.state !== "running") await ctx.resume();

      const source = ctx.createMediaStreamSource(stream);

      const gainNode = ctx.createGain();
      gainNode.gain.value = gain;
      gainNodeRef.current = gainNode;
      source.connect(gainNode);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      gainNode.connect(analyser);
      const levelData = new Uint8Array(analyser.frequencyBinCount);
      const meterLoop = () => {
        analyser.getByteTimeDomainData(levelData);
        let peak = 0;
        for (const v of levelData) peak = Math.max(peak, Math.abs(v - 128) / 128);
        setLevel(peak);
        rafRef.current = requestAnimationFrame(meterLoop);
      };
      meterLoop();

      const encoder = new Mp3Encoder(1, ctx.sampleRate, 96);
      encoderRef.current = encoder;

      // ScriptProcessorNode ist veraltet, aber (noch) überall unterstützt – ein AudioWorklet wäre
      // hier nur unnötige Zusatzkomplexität. Trotzdem defensiv prüfen: falls ein Browser die
      // Methode doch einmal entfernt hat, soll das eine klare Meldung geben statt eines rohen
      // "is not a function"-Absturzes.
      if (typeof ctx.createScriptProcessor !== "function") {
        throw new Error("Dieser Browser unterstützt die benötigte Audio-Verarbeitung nicht mehr.");
      }
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        // WICHTIG: ScriptProcessorNode liefert von sich aus NUR Stille am Ausgang – ohne dieses
        // Kopieren des Eingangs in den Ausgangspuffer bliebe das Selbst-Mithören (monitorNode)
        // immer stumm, egal wie hoch dessen Gain steht (Eingang und Ausgang sind getrennte Puffer).
        e.outputBuffer.getChannelData(0).set(input);
        const samples = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const encoded = encoder.encodeBuffer(samples);
        if (encoded.length > 0 && !mutedRef.current) pendingRef.current.push(encoded);
      };
      gainNode.connect(processor);
      // ScriptProcessorNode feuert in manchen Browsern (Chrome) nur, wenn es an ein Ziel
      // angeschlossen ist – deshalb über einen eigenen, standardmäßig stummen Gain-Knoten geführt.
      // Gleichzeitig dient genau dieser Knoten als Selbst-Mithören-Regler (setMonitor): auf
      // Kopfhörern kann er hochgedreht werden, ohne den Encoder-Pfad zu berühren.
      const monitorNode = ctx.createGain();
      monitorNode.gain.value = monitor ? 0.8 : 0;
      monitorNodeRef.current = monitorNode;
      processor.connect(monitorNode);
      monitorNode.connect(ctx.destination);

      flushTimerRef.current = setInterval(sendPending, CHUNK_MS);
      setActive(true);
    } catch (err) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void ctxRef.current?.close();
      ctxRef.current = null;
      if (err instanceof DOMException) {
        setError(
          err.name === "NotAllowedError"
            ? "Mikrofon-Zugriff wurde verweigert – im Browser bei den Website-Einstellungen erlauben und neu laden."
            : err.name === "NotFoundError"
              ? "Kein Mikrofon gefunden – Gerät anschließen/auswählen und erneut versuchen."
              : err.name === "NotReadableError"
                ? "Mikrofon ist bereits durch eine andere App/Tab belegt."
                : err.name === "SecurityError"
                  ? "Mikrofon-Zugriff hier aus Sicherheitsgründen blockiert (braucht HTTPS)."
                  : `Mikrofon-Fehler (${err.name}): ${err.message}`,
        );
      } else if (err instanceof Error) {
        // Kein DOMException (z. B. fehlende AudioContext-/ScriptProcessor-Unterstützung) – hier
        // IMMER die echte Fehlermeldung mit ausgeben, statt eines nichtssagenden Standardtexts,
        // sonst lässt sich die eigentliche Ursache nie herausfinden.
        setError(`Mikrofon konnte nicht gestartet werden – ${err.message}`);
      } else {
        setError("Mikrofon konnte nicht gestartet werden (unbekannter Fehler).");
      }
    }
  }, [active, gain, monitor, sendPending]);

  useEffect(() => () => stop(), [stop]);

  return {
    active,
    muted,
    setMuted,
    monitor,
    setMonitor,
    level,
    gain,
    setGain,
    sentBytes,
    error,
    start,
    stop,
  };
}
