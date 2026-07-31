import { useCallback, useEffect, useRef, useState } from "react";
import { Mp3Encoder } from "lamejs";
// Behebt mehrere fehlende globale Referenzen im lamejs-Paket selbst (siehe lame-shim.ts für
// Details). Muss vor dem ersten Mp3Encoder-Aufruf laufen – als aufgerufene Funktion, nicht als
// reiner Side-Effect-Import (sonst wird er bei "sideEffects": false wegoptimiert).
import { installLameGlobals } from "./lame-shim";
installLameGlobals();

/** Sendeintervall der MP3-Chunks zum Server – klein genug für echtes Live-Gefühl, groß genug,
 *  um nicht bei jedem winzigen Encoder-Aufruf einen eigenen HTTP-Request zu feuern. */
const CHUNK_MS = 300;
/** Lautstärke des Musik-Beds, während darüber gesprochen wird (Talkover-Ducking). */
const BED_DUCK = 0.15;
/** Lautstärke des Musik-Beds, sobald die Moderation aufhört zu sprechen (Musik wieder voll). */
const BED_FULL = 1.0;

/**
 * Nimmt das Mikrofon im Browser auf, kodiert es live zu MP3 (lamejs, reines JS – kein Server-
 * Transkodieren nötig) und schickt die fertigen Bytes per POST an /api/mic-stream, von wo die
 * Sende-Engine sie direkt an alle /live-stream-Hörer:innen weiterreicht. Liefert zusätzlich einen
 * einfachen Pegelwert (0..1) für eine VU-Anzeige im Studio (gleiches Muster wie der alte,
 * rein kosmetische VU-Meter in use-radio-engine.ts, hier aber am echten Sende-Signal) sowie
 * sentBytes/lastError, damit im Studio sichtbar ist, ob wirklich Daten rausgehen – ohne das gäbe
 * es keine Rückmeldung, falls z. B. die Berechtigung verweigert wurde oder der Upload fehlschlägt.
 *
 * Optional lässt sich ein "Bed" (Musik) unterlegen: der Browser mixt Mic + geducktes Musik-Bed
 * live zusammen und sendet die Mischung als einen Stereo-MP3-Stream – echte Talkover, ohne dass
 * der Server zwei Streams mischen müsste (der Server reicht die gemischten Bytes des Mic-Elements
 * einfach weiter wie immer). Der Duck-Regler hebt das Bed von „leise (drunter sprechen)" auf
 * „voll (Musik wieder laut)" – klassisches Radio-Intro-Talkover.
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
  const [bedActive, setBedActive] = useState(false);
  const [bedTitle, setBedTitle] = useState("");
  const [duck, setDuckState] = useState(true);
  const [bedLoading, setBedLoading] = useState(false);
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
  // Bed-Knoten (Musik-Unterlegung für Talkover): ein AudioBufferSourceNode + eigenen Gain-Knoten,
  // der den Duck-Zustand regelt. Diese Refs werden bei attachBed gesetzt und bei stop/detach sau-
  // ber getrennt, damit das Bed nicht unbeabsichtigt weiterläuft.
  const bedSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bedGainRef = useRef<GainNode | null>(null);
  const bedEndedRef = useRef<(() => void) | null>(null);
  const duckRef = useRef(true);

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

  const setDuck = useCallback((value: boolean) => {
    setDuckState(value);
    duckRef.current = value;
    if (bedGainRef.current && ctxRef.current) {
      bedGainRef.current.gain.setTargetAtTime(
        value ? BED_DUCK : BED_FULL,
        ctxRef.current.currentTime,
        0.2,
      );
    }
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

  const detachBed = useCallback(() => {
    if (bedSourceRef.current) {
      try {
        bedSourceRef.current.onended = null;
        bedSourceRef.current.stop();
      } catch {
        /* schon beendet */
      }
      try {
        bedSourceRef.current.disconnect();
      } catch {
        /* ignoriert */
      }
      bedSourceRef.current = null;
    }
    if (bedGainRef.current) {
      try {
        bedGainRef.current.disconnect();
      } catch {
        /* ignoriert */
      }
      bedGainRef.current = null;
    }
    bedEndedRef.current = null;
    setBedActive(false);
    setBedTitle("");
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
    detachBed();
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
    setDuckState(true);
    duckRef.current = true;
    mutedRef.current = false;
    setMutedState(false);
  }, [detachBed, sendPending]);

  /**
   * Unterlegt ein Musik-Bed (Talkover): lädt die Audiodaten, dekodiert sie im AudioContext
   * (gleiche Sample-Rate wie das Mic – kein Resampling nötig) und spielt sie über einen eigenen
   * Gain-Knoten geduckt neben dem Mic in den Encoder. Die gemischten Stereo-Bytes landen wie das
   * reine Mic auch über /api/mic-stream im Livestream – der Server mischt nichts, er reicht die
   * fertige Mischung einfach weiter. offsetSec startet das Bed z. B. ab dem Intro (Standard 0).
   * onEnded wird gerufen, sobald das Bed zu Ende ist (z. B. um das Mic-Element automatisch zu
   * beenden, damit die Engine zum nächsten Element weiterspringt).
   */
  const loadBed = useCallback(
    async (src: string, title: string, offsetSec = 0, onEnded?: () => void) => {
      const ctx = ctxRef.current;
      if (!ctx || !processorRef.current) {
        setError("Mikrofon muss gestartet sein, bevor ein Bed unterlegt wird.");
        return;
      }
      setBedLoading(true);
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`Bed nicht ladbar (${res.status})`);
        const arr = await res.arrayBuffer();
        const buffer = await ctx.decodeAudioData(arr);
        // Altes Bed sicher entfernen, falls schon eines läuft.
        detachBed();
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const bedGain = ctx.createGain();
        bedGain.gain.value = duckRef.current ? BED_DUCK : BED_FULL;
        source.connect(bedGain);
        bedGain.connect(processorRef.current);
        bedSourceRef.current = source;
        bedGainRef.current = bedGain;
        bedEndedRef.current = onEnded ?? null;
        source.onended = () => {
          detachBed();
          bedEndedRef.current?.();
        };
        source.start(0, Math.min(offsetSec, buffer.duration - 0.1));
        setBedTitle(title);
        setBedActive(true);
      } catch (err) {
        setError(
          err instanceof Error
            ? `Musik-Bed konnte nicht geladen werden – ${err.message}`
            : "Musik-Bed konnte nicht geladen werden.",
        );
      } finally {
        setBedLoading(false);
      }
    },
    [detachBed],
  );

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
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor)
        throw new Error("Web Audio API (AudioContext) wird nicht unterstützt.");

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

      // Pegelanzeige am reinen Mic-Signal (unabhängig vom Bed) – so zeigt der VU-Meter die Stimme
      // und nicht das mitgemischte Musik-Bed.
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

      // Stereo-Encoder: das Mic (mono) liegt gleichermaßen auf beiden Kanälen, das optionale Bed
      // (meist Stereo) kommt geduckt dazu – so entsteht ein echter Stereo-Mix statt eines dumpfen
      // Mono-Signals, Musik klingt auch im Talkover-Bed akzeptabel.
      const encoder = new Mp3Encoder(2, ctx.sampleRate, 128);
      encoderRef.current = encoder;

      // ScriptProcessorNode ist veraltet, aber (noch) überall unterstützt – ein AudioWorklet wäre
      // hier nur unnötige Zusatzkomplexität. Trotzdem defensiv prüfen: falls ein Browser die
      // Methode doch einmal entfernt hat, soll das eine klare Meldung geben statt eines rohen
      // "is not a function"-Absturzes. 2 Eingangs-/Ausgangskanäle für Stereo (Mic + Bed-Mix).
      if (typeof ctx.createScriptProcessor !== "function") {
        throw new Error("Dieser Browser unterstützt die benötigte Audio-Verarbeitung nicht mehr.");
      }
      const processor = ctx.createScriptProcessor(4096, 2, 2);
      processorRef.current = processor;
      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer;
        const ch0 = input.getChannelData(0);
        const ch1 = input.numberOfChannels > 1 ? input.getChannelData(1) : ch0;
        // WICHTIG: ScriptProcessorNode liefert von sich aus NUR Stille am Ausgang – ohne dieses
        // Kopieren des Eingangs in den Ausgangspuffer bliebe das Selbst-Mithören (monitorNode)
        // immer stumm, egal wie hoch dessen Gain steht (Eingang und Ausgang sind getrennte Puffer).
        e.outputBuffer.getChannelData(0).set(ch0);
        if (e.outputBuffer.numberOfChannels > 1) e.outputBuffer.getChannelData(1).set(ch1);
        const samples0 = new Int16Array(ch0.length);
        const samples1 = new Int16Array(ch1.length);
        for (let i = 0; i < ch0.length; i++) {
          const s0 = Math.max(-1, Math.min(1, ch0[i]));
          samples0[i] = s0 < 0 ? s0 * 0x8000 : s0 * 0x7fff;
          const v1 = ch1[i] ?? ch0[i];
          const s1 = Math.max(-1, Math.min(1, v1));
          samples1[i] = s1 < 0 ? s1 * 0x8000 : s1 * 0x7fff;
        }
        const encoded = encoder.encodeBuffer(samples0, samples1);
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

  useEffect(() => () => void stop(), [stop]);

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
    // Talkover-Bed
    bedActive,
    bedTitle,
    bedLoading,
    duck,
    setDuck,
    loadBed,
    detachBed,
  };
}
