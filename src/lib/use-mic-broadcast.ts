import { useCallback, useEffect, useRef, useState } from "react";
import { Mp3Encoder } from "lamejs";

/** Sendeintervall der MP3-Chunks zum Server – klein genug für echtes Live-Gefühl, groß genug,
 *  um nicht bei jedem winzigen Encoder-Aufruf einen eigenen HTTP-Request zu feuern. */
const CHUNK_MS = 300;

/**
 * Nimmt das Mikrofon im Browser auf, kodiert es live zu MP3 (lamejs, reines JS – kein Server-
 * Transkodieren nötig) und schickt die fertigen Bytes per POST an /api/mic-stream, von wo die
 * Sende-Engine sie direkt an alle /live-stream-Hörer:innen weiterreicht. Liefert zusätzlich einen
 * einfachen Pegelwert (0..1) für eine VU-Anzeige im Studio (gleiches Muster wie der alte,
 * rein kosmetische VU-Meter in use-radio-engine.ts, hier aber am echten Sende-Signal).
 */
export function useMicBroadcast() {
  const [active, setActive] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [level, setLevel] = useState(0);
  // Eingangslautstärke (Vorverstärkung): 1 = unverändert, bis 2 = doppelt so laut – wirkt sowohl
  // auf das tatsächlich gesendete Signal als auch auf die Pegelanzeige, damit der Bediener direkt
  // sieht, wie laut es beim Hörer ankommt.
  const [gain, setGainState] = useState(1);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
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
    void fetch("/api/mic-stream", { method: "POST", body: merged }).catch(() => undefined);
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
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    setActive(false);
    setLevel(0);
    mutedRef.current = false;
    setMutedState(false);
  }, [sendPending]);

  const start = useCallback(async () => {
    if (active) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const ctx = new AudioContext();
    ctxRef.current = ctx;
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

    // ScriptProcessorNode ist veraltet, aber für dieses reine Sprach-Encoding in jedem Browser
    // unterstützt – ein AudioWorklet wäre hier nur unnötige Zusatzkomplexität.
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
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
    // angeschlossen ist – stummgeschaltet, damit sich der Bediener nicht selbst als Echo hört.
    const silentSink = ctx.createGain();
    silentSink.gain.value = 0;
    processor.connect(silentSink);
    silentSink.connect(ctx.destination);

    flushTimerRef.current = setInterval(sendPending, CHUNK_MS);
    setActive(true);
  }, [active, gain, sendPending]);

  useEffect(() => () => stop(), [stop]);

  return { active, muted, setMuted, level, gain, setGain, start, stop };
}
