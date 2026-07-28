/**
 * Sehr leichter MP3-Parser (keine Abhängigkeit nötig): überspringt ID3-Tags am Anfang/Ende und
 * ermittelt die echte Hördauer, indem alle MPEG-Audio-Frames durchlaufen werden – Frame für
 * Frame, nicht mit einer angenommenen festen Bitrate, funktioniert also auch bei VBR-Dateien.
 *
 * Wird gebraucht, weil die geplante Dauer (Textlänge/145-Wörter-pro-Minute-Schätzung bzw.
 * Metadaten der freien Musiksuche) regelmäßig von der tatsächlich erzeugten/heruntergeladenen
 * Audiodatei abweicht – das führte zu langen Stille-Pausen (Plan wartet auf die geschätzte Dauer,
 * obwohl die Audiodatei längst zu Ende ist) oder abgeschnittenen Anfängen (der ID3-Tag mit
 * eingebettetem Cover-Bild wurde in der Zeit-zu-Byte-Umrechnung des Livestreams mitgezählt, als
 * wäre er Audio).
 */

type FrameInfo = { frameSize: number; samplesPerFrame: number; sampleRate: number };

const V1_BITRATES: Record<number, number[]> = {
  1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
};
const V2_BITRATES: Record<number, number[]> = {
  1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
// Index: MPEG-Versionsbits (0 = 2.5, 2 = MPEG2, 3 = MPEG1).
const SAMPLE_RATES: Record<number, number[]> = {
  0: [11025, 12000, 8000],
  2: [22050, 24000, 16000],
  3: [44100, 48000, 32000],
};
const SAMPLES_PER_FRAME: Record<string, number> = {
  "3-1": 384,
  "3-2": 1152,
  "3-3": 1152,
  "2-1": 384,
  "2-2": 1152,
  "2-3": 576,
  "0-1": 384,
  "0-2": 1152,
  "0-3": 576,
};

function parseFrame(buf: Buffer, offset: number): FrameInfo | null {
  if (offset + 4 > buf.length) return null;
  const b1 = buf[offset];
  const b2 = buf[offset + 1];
  const b3 = buf[offset + 2];
  if (b1 !== 0xff || (b2 & 0xe0) !== 0xe0) return null;
  const versionBits = (b2 >> 3) & 0x3; // 0=MPEG2.5, 1=reserviert, 2=MPEG2, 3=MPEG1
  if (versionBits === 1) return null;
  const layerBits = (b2 >> 1) & 0x3; // 0=reserviert, 1=Layer III, 2=Layer II, 3=Layer I
  if (layerBits === 0) return null;
  const layer = 4 - layerBits;
  const bitrateIndex = (b3 >> 4) & 0xf;
  const sampleRateIndex = (b3 >> 2) & 0x3;
  if (bitrateIndex === 0 || bitrateIndex === 0xf || sampleRateIndex === 3) return null;
  const table = versionBits === 3 ? V1_BITRATES[layer] : V2_BITRATES[layer];
  const bitrate = table?.[bitrateIndex];
  if (!bitrate) return null;
  const sampleRate = SAMPLE_RATES[versionBits]?.[sampleRateIndex];
  if (!sampleRate) return null;
  const padding = (b3 >> 1) & 0x1;
  const samplesPerFrame = SAMPLES_PER_FRAME[`${versionBits}-${layer}`] ?? 1152;
  const frameSize =
    layer === 1
      ? (Math.floor((12 * bitrate * 1000) / sampleRate) + padding) * 4
      : Math.floor((samplesPerFrame / 8) * ((bitrate * 1000) / sampleRate)) + padding;
  if (frameSize <= 0) return null;
  return { frameSize, samplesPerFrame, sampleRate };
}

export type Mp3Analysis = { audioStart: number; audioEnd: number; durationSeconds: number };

/** Ermittelt Audio-Start/-Ende (ohne ID3-Tags) und die echte Hördauer einer MP3-Datei. */
export function analyzeMp3(buf: Buffer): Mp3Analysis {
  let start = 0;
  if (buf.length >= 10 && buf.toString("latin1", 0, 3) === "ID3") {
    const size =
      ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    start = 10 + size;
  }
  // Manche Encoder hängen noch ein paar Padding-Bytes an – in einem kleinen Fenster nach dem
  // erwarteten Start nach dem ersten gültigen Frame suchen, statt stur bei "start" zu beginnen.
  let offset = start;
  const searchLimit = Math.min(buf.length - 4, start + 4096);
  while (offset <= searchLimit && !parseFrame(buf, offset)) offset++;
  if (offset > searchLimit) {
    return { audioStart: Math.min(start, buf.length), audioEnd: buf.length, durationSeconds: 0 };
  }

  const audioStart = offset;
  let seconds = 0;
  let end = offset;
  while (offset + 4 <= buf.length) {
    const frame = parseFrame(buf, offset);
    if (!frame) break;
    seconds += frame.samplesPerFrame / frame.sampleRate;
    offset += frame.frameSize;
    end = offset;
  }
  return { audioStart, audioEnd: end, durationSeconds: seconds };
}
