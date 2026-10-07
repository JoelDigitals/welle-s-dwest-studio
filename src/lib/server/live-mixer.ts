import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { MPEGDecoder } from "mpg123-decoder";
import { Mp3Encoder } from "lamejs";
import { installLameGlobals } from "@/lib/lame-shim";

/**
 * Sendemischer (wie das Pult einer echten Radio-Software): jedes laufende Element ist ein eigenes
 * "Deck" (Musik, Sprache, Jingle/FX, Bett, Live-Mikrofon). Alle Decks werden fortlaufend in
 * Echtzeit dekodiert und zu EINEM Signal gemischt – mit Ducking (Musik/Bett leiser, solange
 * gesprochen wird), Ausblenden unter Jingles und Überlappungen an den Übergängen. Ein einziger
 * Encoder macht daraus einen durchgehenden Stream mit festem Format (44,1 kHz Stereo, 128 kbit/s)
 * ohne Datei-Grenzen; läuft gerade nichts, wird Stille gesendet – der Stream reißt nie ab.
 *
 * Kodiert wird mit ffmpeg (nativ, schnell genug für die kleine Render-CPU); ist kein ffmpeg
 * verfügbar, springt lamejs ein (langsamer, deshalb dann in Mono).
 */

export const MIX_RATE = 44100;
const TICK_MS = 100;
/** Musik/Bett unter Sprache (Regel 6: −6 … −12 dB). */
const DUCK_GAIN = Math.pow(10, -9 / 20);
const BED_GAIN = Math.pow(10, -12 / 20);
/** Gain-Änderung pro Sample (≈ 250 ms für einen vollen Wechsel) – weiche Übergänge. */
const GAIN_STEP = 1 / (MIX_RATE * 0.25);
/** So viel bereits kodierter Stream wird neuen Hörer:innen sofort mitgegeben (schneller Start). */
const RING_BYTES = 96 * 1024;

export type DeckRole = "music" | "voice" | "fx" | "bed" | "mic";

type Deck = {
  id: string;
  uid: string;
  role: DeckRole;
  source: Buffer;
  sourcePos: number;
  decoder: MPEGDecoder | null;
  ready: Promise<void>;
  queue: Float32Array[]; // [L, R] zusammenhängend (Rest aus dem letzten Dekodieren)
  left: Float32Array;
  right: Float32Array;
  gain: number;
  base: number;
  fadeOutPerSample: number; // > 0: wird ausgeblendet
  loop: boolean;
  followDeckId: string | null; // Bett: endet mit diesem Deck
  live: boolean; // Mikrofon: Daten kommen fortlaufend nach
  liveBuffered: boolean;
  done: boolean;
  resample: { srcRate: number; pos: number; lastL: number; lastR: number } | null;
};

type Listener = { controller: ReadableStreamDefaultController<Uint8Array> };

const g = globalThis as unknown as {
  __liveMixer?: {
    decks: Deck[];
    listeners: Set<Listener>;
    ring: Buffer[];
    ringBytes: number;
    encoder: Encoder | null;
    lastTick: number;
    timer: ReturnType<typeof setInterval> | null;
    counter: number;
  };
};

function mixer() {
  g.__liveMixer ??= {
    decks: [],
    listeners: new Set(),
    ring: [],
    ringBytes: 0,
    encoder: null,
    lastTick: 0,
    timer: null,
    counter: 0,
  };
  return g.__liveMixer;
}

/* ------------------------------------------------------------------ Encoder */

type Encoder = { write(pcm: Int16Array): void; kind: string };

function broadcast(chunk: Buffer) {
  const m = mixer();
  m.ring.push(chunk);
  m.ringBytes += chunk.length;
  while (m.ringBytes > RING_BYTES && m.ring.length > 1) m.ringBytes -= m.ring.shift()!.length;
  const bytes = new Uint8Array(chunk);
  for (const l of m.listeners) {
    try {
      l.controller.enqueue(bytes);
    } catch {
      m.listeners.delete(l);
    }
  }
}

function ffmpegPath(): string | null {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    // Über das Projektverzeichnis auflösen (nicht über das gebündelte .output), dort liegt die
    // von ffmpeg-static beim Installieren heruntergeladene Binary.
    const req = createRequire(path.join(process.cwd(), "package.json"));
    const p = req("ffmpeg-static") as string | null;
    if (p) return p;
  } catch {
    /* nicht installiert */
  }
  return "ffmpeg";
}

function startFfmpeg(onFail: () => void): Encoder | null {
  const bin = ffmpegPath();
  if (!bin) return null;
  let proc: ChildProcessWithoutNullStreams;
  try {
    proc = spawn(bin, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "s16le",
      "-ar",
      String(MIX_RATE),
      "-ac",
      "2",
      "-i",
      "pipe:0",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      // Schnellster LAME-Modus: bei 128 kbit/s kaum hörbar, aber deutlich weniger CPU (Render Free).
      "-compression_level",
      "9",
      "-write_xing",
      "0",
      "-id3v2_version",
      "0",
      "-flush_packets",
      "1",
      "-f",
      "mp3",
      "pipe:1",
    ]);
  } catch {
    return null;
  }
  let alive = true;
  proc.stdout.on("data", (chunk: Buffer) => broadcast(chunk));
  proc.stderr.on("data", (d: Buffer) => console.error("[live-mixer] ffmpeg:", d.toString().trim()));
  const fail = () => {
    if (!alive) return;
    alive = false;
    onFail();
  };
  proc.on("error", fail);
  proc.on("exit", fail);
  proc.stdin.on("error", () => undefined);
  return {
    kind: "ffmpeg",
    write(pcm) {
      if (alive) proc.stdin.write(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    },
  };
}

function startLame(): Encoder {
  installLameGlobals();
  // Mono spart die Hälfte der Rechenzeit – lamejs ist reines JavaScript.
  const enc = new Mp3Encoder(1, MIX_RATE, 96);
  return {
    kind: "lamejs",
    write(pcm) {
      const mono = new Int16Array(pcm.length / 2);
      for (let i = 0; i < mono.length; i++) mono[i] = (pcm[2 * i] + pcm[2 * i + 1]) >> 1;
      const out = enc.encodeBuffer(mono);
      if (out.length) broadcast(Buffer.from(out));
    },
  };
}

function ensureEncoder() {
  const m = mixer();
  if (m.encoder) return m.encoder;
  const ff = startFfmpeg(() => {
    console.error("[live-mixer] ffmpeg beendet – Encoder wird neu gestartet.");
    m.encoder = null;
  });
  m.encoder = ff ?? startLame();
  console.log(`[live-mixer] Dauer-Stream läuft (Encoder: ${m.encoder.kind}).`);
  return m.encoder;
}

/* ------------------------------------------------------------------ Decks */

function resampleChunk(deck: Deck, channels: Float32Array[], srcRate: number) {
  const l = channels[0] ?? new Float32Array(0);
  const r = channels[1] ?? l;
  if (srcRate === MIX_RATE) return [l, r];
  deck.resample ??= { srcRate, pos: 0, lastL: 0, lastR: 0 };
  const st = deck.resample;
  const step = srcRate / MIX_RATE;
  const outL: number[] = [];
  const outR: number[] = [];
  // pos ist relativ zum Beginn dieses Chunks; Index -1 = letztes Sample des vorigen Chunks.
  while (st.pos < l.length - 1) {
    const i0 = Math.floor(st.pos);
    const frac = st.pos - i0;
    const l0 = i0 < 0 ? st.lastL : l[i0];
    const r0 = i0 < 0 ? st.lastR : r[i0];
    outL.push(l0 + (l[i0 + 1] - l0) * frac);
    outR.push(r0 + (r[i0 + 1] - r0) * frac);
    st.pos += step;
  }
  st.pos -= l.length;
  st.lastL = l[l.length - 1] ?? 0;
  st.lastR = r[r.length - 1] ?? 0;
  return [Float32Array.from(outL), Float32Array.from(outR)];
}

function append(deck: Deck, l: Float32Array, r: Float32Array) {
  const nl = new Float32Array(deck.left.length + l.length);
  nl.set(deck.left);
  nl.set(l, deck.left.length);
  const nr = new Float32Array(deck.right.length + r.length);
  nr.set(deck.right);
  nr.set(r, deck.right.length);
  deck.left = nl;
  deck.right = nr;
}

/** Dekodiert so viel Quell-MP3 nach, bis mindestens `need` Samples bereitliegen. */
function fill(deck: Deck, need: number) {
  if (!deck.decoder) return;
  let guard = 0;
  while (deck.left.length < need && guard++ < 40) {
    if (deck.sourcePos >= deck.source.length) {
      if (deck.loop && deck.source.length) {
        deck.sourcePos = 0;
      } else {
        return;
      }
    }
    const chunk = deck.source.subarray(deck.sourcePos, deck.sourcePos + 16 * 1024);
    deck.sourcePos += chunk.length;
    const res = deck.decoder.decode(new Uint8Array(chunk));
    if (res.samplesDecoded) {
      const [l, r] = resampleChunk(deck, res.channelData, res.sampleRate);
      append(deck, l, r);
    }
  }
}

function newDeck(uid: string, role: DeckRole, source: Buffer, opts: Partial<Deck> = {}): Deck {
  const m = mixer();
  const deck: Deck = {
    id: `d${++m.counter}`,
    uid,
    role,
    source,
    sourcePos: 0,
    decoder: null,
    ready: Promise.resolve(),
    queue: [],
    left: new Float32Array(0),
    right: new Float32Array(0),
    gain: 0,
    base: role === "bed" ? BED_GAIN : 1,
    fadeOutPerSample: 0,
    loop: false,
    followDeckId: null,
    live: false,
    liveBuffered: false,
    done: false,
    resample: null,
    ...opts,
  };
  // Kurzer Einstieg (~20 ms) gegen Knackser; Überlappungs-Einstiege regelt das Ducking.
  deck.gain = role === "music" || role === "bed" ? 0 : 1;
  const decoder = new MPEGDecoder();
  deck.ready = decoder.ready.then(() => {
    deck.decoder = decoder;
  });
  m.decks.push(deck);
  return deck;
}

/** Element starten. `fadeOthersSeconds`: laufende Musik in dieser Zeit ausblenden (Jingle über
 *  dem Song-Ende). Musik unter Sprache wird automatisch geduckt. */
export function playDeck(opts: {
  uid: string;
  role: Exclude<DeckRole, "bed" | "mic">;
  audio: Buffer;
  bed?: Buffer | null;
  fadeOthersSeconds?: number;
}) {
  startMixer();
  const m = mixer();
  if (opts.fadeOthersSeconds && opts.fadeOthersSeconds > 0) {
    for (const d of m.decks) {
      if (!d.done && d.role === "music") {
        d.fadeOutPerSample = 1 / (MIX_RATE * opts.fadeOthersSeconds);
      }
    }
  }
  const deck = newDeck(opts.uid, opts.role, opts.audio);
  if (opts.bed?.length) {
    newDeck(opts.uid, "bed", opts.bed, { loop: true, followDeckId: deck.id });
  }
}

/** Live-Mikrofon: Deck, das fortlaufend MP3-Chunks aus dem Studio bekommt. */
export function startMicDeck(uid: string) {
  startMixer();
  const m = mixer();
  if (m.decks.some((d) => d.uid === uid && d.role === "mic" && !d.done)) return;
  newDeck(uid, "mic", Buffer.alloc(0), { live: true });
}

export function pushMicChunk(uid: string, chunk: Buffer) {
  const deck = mixer().decks.find((d) => d.uid === uid && d.role === "mic" && !d.done);
  if (!deck) return false;
  deck.source = Buffer.concat([deck.source.subarray(deck.sourcePos), chunk]);
  deck.sourcePos = 0;
  return true;
}

/** Element (und sein Bett) sanft beenden, z. B. beim Weiterschalten von Hand. */
export function stopDeck(uid: string, fadeSeconds = 0.3) {
  for (const d of mixer().decks) {
    if (d.uid === uid && !d.done) d.fadeOutPerSample = 1 / (MIX_RATE * fadeSeconds);
  }
}

export function stopAllDecks(fadeSeconds = 0.5) {
  for (const d of mixer().decks) {
    if (!d.done) d.fadeOutPerSample = 1 / (MIX_RATE * fadeSeconds);
  }
}

/* ------------------------------------------------------------------ Mischen */

function mixTick() {
  const m = mixer();
  const now = performance.now();
  if (!m.lastTick) m.lastTick = now;
  let samples = Math.round(((now - m.lastTick) / 1000) * MIX_RATE);
  if (samples <= 0) return;
  // Nach einem Hänger (z. B. CPU kurz blockiert) nicht Minuten nachholen – max. 1 s.
  if (samples > MIX_RATE) {
    m.lastTick = now - 1000;
    samples = MIX_RATE;
  }
  m.lastTick += (samples / MIX_RATE) * 1000;

  const outL = new Float32Array(samples);
  const outR = new Float32Array(samples);
  const speaking = m.decks.some(
    (d) => !d.done && (d.role === "voice" || d.role === "mic") && d.left.length > 0,
  );

  for (const deck of m.decks) {
    if (deck.done || !deck.decoder) continue;
    fill(deck, samples);
    if (deck.live && !deck.liveBuffered) {
      // Mikrofon: erst ~0,4 s puffern, damit Netzwerk-Schwankungen nicht stottern.
      if (deck.left.length < MIX_RATE * 0.4) continue;
      deck.liveBuffered = true;
    }
    const follow = deck.followDeckId ? m.decks.find((d) => d.id === deck.followDeckId) : null;
    if (follow && follow.done && !deck.fadeOutPerSample)
      deck.fadeOutPerSample = 1 / (MIX_RATE * 1.2);
    const target =
      deck.role === "music" ? (speaking ? DUCK_GAIN : 1) : deck.role === "bed" ? deck.base : 1;
    const n = Math.min(samples, deck.left.length);
    for (let i = 0; i < n; i++) {
      if (deck.fadeOutPerSample) {
        deck.gain = Math.max(0, deck.gain - deck.fadeOutPerSample);
      } else if (deck.gain < target) {
        deck.gain = Math.min(target, deck.gain + GAIN_STEP);
      } else if (deck.gain > target) {
        deck.gain = Math.max(target, deck.gain - GAIN_STEP);
      }
      outL[i] += deck.left[i] * deck.gain;
      outR[i] += deck.right[i] * deck.gain;
    }
    deck.left = deck.left.subarray(n);
    deck.right = deck.right.subarray(n);
    const exhausted =
      !deck.live && !deck.loop && deck.left.length === 0 && deck.sourcePos >= deck.source.length;
    if (exhausted || (deck.fadeOutPerSample && deck.gain <= 0)) {
      deck.done = true;
      deck.decoder?.free();
    }
  }
  m.decks = m.decks.filter((d) => !d.done);

  const pcm = new Int16Array(samples * 2);
  for (let i = 0; i < samples; i++) {
    // Weicher Limiter gegen Übersteuern, wenn sich Elemente überlagern.
    const l = Math.tanh(outL[i]);
    const r = Math.tanh(outR[i]);
    pcm[2 * i] = l * 32767;
    pcm[2 * i + 1] = r * 32767;
  }
  ensureEncoder().write(pcm);
}

export function startMixer() {
  const m = mixer();
  if (m.timer) return;
  m.lastTick = performance.now();
  m.timer = setInterval(() => {
    try {
      mixTick();
    } catch (err) {
      console.error("[live-mixer] Fehler beim Mischen:", err);
    }
  }, TICK_MS);
}

/** Neue:r Hörer:in für /live-stream – bekommt sofort die letzten Sekunden mit (schneller Start),
 *  danach den laufenden Dauer-Stream. */
export function subscribeStream(): ReadableStream<Uint8Array> {
  startMixer();
  const m = mixer();
  let listener: Listener;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      listener = { controller };
      for (const chunk of m.ring) controller.enqueue(new Uint8Array(chunk));
      m.listeners.add(listener);
    },
    cancel() {
      m.listeners.delete(listener);
    },
  });
}

export function listenerCount() {
  return mixer().listeners.size;
}
