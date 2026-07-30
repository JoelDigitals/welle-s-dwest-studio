declare module "lamejs" {
  export class Mp3Encoder {
    constructor(channels: number, sampleRate: number, kbps: number);
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
    flush(): Int8Array;
  }
}

// lamejs' eigene interne Dateien (Lame.js, BitStream.js, Encoder.js, PsyModel.js, Quantize.js,
// QuantizePVT.js, Presets.js, VBRTag.js) verwenden Klassen wie "MPEGMode.STEREO" oder "new Lame()",
// ohne sie jemals per require zu importieren (Fehler im Paket selbst) – funktioniert nur zufällig
// in Bundlern/Umgebungen, in denen ein anderes Modul sie vorher als globale Variable hinterlässt.
// Unter Vites Browser-Bundling (ESM, kein implizites globales Scope-Leck) fehlen sie alle und es
// gibt "ReferenceError: X is not defined" beim tatsächlichen Encodieren. Deep-Imports, um jede
// betroffene Klasse selbst per globalThis bereitzustellen (siehe src/lib/lame-shim.ts).
declare module "lamejs/src/js/MPEGMode.js" {
  const MPEGMode: unknown;
  export default MPEGMode;
}
declare module "lamejs/src/js/Lame.js" {
  const Lame: unknown;
  export default Lame;
}
declare module "lamejs/src/js/GainAnalysis.js" {
  const GainAnalysis: unknown;
  export default GainAnalysis;
}
declare module "lamejs/src/js/ATH.js" {
  const ATH: unknown;
  export default ATH;
}
declare module "lamejs/src/js/LameInternalFlags.js" {
  const LameInternalFlags: unknown;
  export default LameInternalFlags;
}
declare module "lamejs/src/js/MeanBits.js" {
  const MeanBits: unknown;
  export default MeanBits;
}
declare module "lamejs/src/js/CalcNoiseResult.js" {
  const CalcNoiseResult: unknown;
  export default CalcNoiseResult;
}
declare module "lamejs/src/js/L3Side.js" {
  const L3Side: unknown;
  export default L3Side;
}
declare module "lamejs/src/js/Tables.js" {
  const Tables: unknown;
  export default Tables;
}
declare module "lamejs/src/js/BitStream.js" {
  const BitStream: unknown;
  export default BitStream;
}
