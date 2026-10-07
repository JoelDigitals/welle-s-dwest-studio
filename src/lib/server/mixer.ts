import { MPEGDecoder } from "mpg123-decoder";
import { Mp3Encoder } from "lamejs";
import { installLameGlobals } from "@/lib/lame-shim";
import { mp3Frames } from "./mp3-audio";

/**
 * Mehrspur-Mischer der Sende-Engine (wie in echter Radio-Software): mischt die Spuren dort, wo
 * sich Elemente überlappen – Jingle/FX über das Song-Ende, kurzer Callout über das Song-Ende
 * (Musik geduckt), Musikbett unter einer kurzen Ansage. Bewusst nur kurze Abschnitte: das
 * Kodieren läuft in Häppchen mit Pausen dazwischen, damit der laufende Live-Stream nie stockt
 * (Render Free hat nur einen Bruchteil eines CPU-Kerns).
 */

type Pcm = { sampleRate: number; channels: Float32Array[] };

let decoderPromise: Promise<MPEGDecoder> | null = null;
async function decoder() {
  decoderPromise ??= (async () => {
    const d = new MPEGDecoder();
    await d.ready;
    return d;
  })();
  return decoderPromise;
}

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function decodeMp3(buf: Buffer): Promise<Pcm> {
  const d = await decoder();
  await d.reset();
  const r = d.decode(new Uint8Array(buf));
  return { sampleRate: r.sampleRate, channels: r.channelData.map((c) => Float32Array.from(c)) };
}

/** Lineares Resampling + Kanalanpassung (Mono <-> Stereo). Für kurze Abschnitte völlig ausreichend. */
function conform(pcm: Pcm, rate: number, channelCount: number): Float32Array[] {
  const src = pcm.channels.length ? pcm.channels : [new Float32Array(0)];
  const ratio = pcm.sampleRate / rate;
  const length = Math.floor(src[0].length / ratio);
  const resampled = src.map((ch) => {
    if (pcm.sampleRate === rate) return ch;
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      out[i] = (ch[i0] ?? 0) * (1 - frac) + (ch[i0 + 1] ?? ch[i0] ?? 0) * frac;
    }
    return out;
  });
  if (channelCount === resampled.length) return resampled;
  if (channelCount === 1) {
    const mono = new Float32Array(resampled[0].length);
    for (let i = 0; i < mono.length; i++) {
      let sum = 0;
      for (const ch of resampled) sum += ch[i] ?? 0;
      mono[i] = sum / resampled.length;
    }
    return [mono];
  }
  return Array.from({ length: channelCount }, (_, i) => resampled[i] ?? resampled[0]);
}

const dbToGain = (db: number) => Math.pow(10, db / 20);

async function encodeMp3(channels: Float32Array[], rate: number, kbps: number): Promise<Buffer> {
  installLameGlobals();
  const stereo = channels.length > 1;
  const encoder = new Mp3Encoder(stereo ? 2 : 1, rate, kbps);
  const toInt16 = (f: Float32Array) => {
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) out[i] = Math.max(-1, Math.min(1, f[i])) * 32767;
    return out;
  };
  const left = toInt16(channels[0]);
  const right = stereo ? toInt16(channels[1]) : left;
  const parts: Buffer[] = [];
  const block = 1152;
  for (let i = 0, n = 0; i < left.length; i += block, n++) {
    const chunk = stereo
      ? encoder.encodeBuffer(left.subarray(i, i + block), right.subarray(i, i + block))
      : encoder.encodeBuffer(left.subarray(i, i + block));
    if (chunk.length) parts.push(Buffer.from(chunk));
    // Alle ~0,5 s Audio kurz an die Event-Loop zurückgeben (Live-Stream-Ticks laufen weiter).
    if (n % 20 === 19) await yieldToLoop();
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(Buffer.from(tail));
  return Buffer.concat(parts);
}

/**
 * Überlappung: das nächste Element (over) beginnt schon `overlapSeconds` vor dem Ende des
 * aktuellen (under). Ergebnis:
 *  - underTrimmed: das aktuelle Element ohne seine letzten Sekunden (framegenau geschnitten, nicht
 *    neu kodiert),
 *  - overMixed: das nächste Element, mit dem abgeschnittenen Rest des aktuellen darunter gemischt –
 *    bei Sprache geduckt (duckDb), bei Jingle/FX sanft ausgeblendet.
 */
export async function mixOverlap(opts: {
  under: Buffer;
  over: Buffer;
  overlapSeconds: number;
  mode: "duck" | "fade";
  duckDb: number;
}): Promise<{ underTrimmed: Buffer; overMixed: Buffer; overlapSeconds: number } | null> {
  const frames = mp3Frames(opts.under);
  if (frames.length < 10) return null;
  const total = frames.reduce((sum, f) => sum + f.seconds, 0);
  let acc = 0;
  let cut = frames.length;
  for (let i = 0; i < frames.length; i++) {
    if (acc >= total - opts.overlapSeconds) {
      cut = i;
      break;
    }
    acc += frames[i].seconds;
  }
  if (cut >= frames.length - 1 || cut < 2) return null;
  const overlapSeconds = total - acc;
  // Ein Frame Vorlauf für das Bit-Reservoir des Decoders – dessen Samples werden verworfen.
  const preroll = frames[cut - 1];
  const tailPcm = await decodeMp3(opts.under.subarray(preroll.offset));
  const overPcm = await decodeMp3(opts.over);
  const rate = 44100;
  const tail = conform(tailPcm, rate, 2).map((ch) =>
    ch.subarray(Math.round(preroll.seconds * rate)),
  );
  const over = conform(overPcm, rate, 2);
  const length = Math.max(over[0].length, tail[0].length);
  const gain = dbToGain(opts.duckDb);
  const mixed = [0, 1].map((c) => {
    const out = new Float32Array(length);
    const t = tail[c];
    const o = over[c];
    for (let i = 0; i < length; i++) {
      const progress = t.length ? i / t.length : 1;
      const underGain = opts.mode === "duck" ? gain : Math.max(0, 1 - progress);
      out[i] = (o[i] ?? 0) + (t[i] ?? 0) * underGain;
    }
    return out;
  });
  const underTrimmed = opts.under.subarray(0, frames[cut].offset);
  const overMixed = await encodeMp3(mixed, rate, 128);
  return { underTrimmed, overMixed, overlapSeconds };
}

/** Musikbett unter einer (kurzen) Ansage: Bett geloopt, um bedDb abgesenkt, am Ende ausgeblendet. */
export async function mixBed(opts: { voice: Buffer; bed: Buffer; bedDb: number }): Promise<Buffer> {
  const voicePcm = await decodeMp3(opts.voice);
  const bedPcm = await decodeMp3(opts.bed);
  const rate = voicePcm.sampleRate;
  const voice = conform(voicePcm, rate, 1)[0];
  const bed = conform(bedPcm, rate, 1)[0];
  if (!bed.length) return opts.voice;
  const fade = Math.round(rate * 1.2);
  const length = voice.length + fade;
  const gain = dbToGain(opts.bedDb);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const bedGain = i < voice.length ? gain : gain * (1 - (i - voice.length) / fade);
    out[i] = (voice[i] ?? 0) + bed[i % bed.length] * bedGain;
  }
  return encodeMp3([out], rate, 64);
}
