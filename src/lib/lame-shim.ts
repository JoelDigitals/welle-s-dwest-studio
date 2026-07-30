import MPEGMode from "lamejs/src/js/MPEGMode.js";
import Lame from "lamejs/src/js/Lame.js";
import GainAnalysis from "lamejs/src/js/GainAnalysis.js";
import ATH from "lamejs/src/js/ATH.js";
import LameInternalFlags from "lamejs/src/js/LameInternalFlags.js";
import MeanBits from "lamejs/src/js/MeanBits.js";
import CalcNoiseResult from "lamejs/src/js/CalcNoiseResult.js";
import L3Side from "lamejs/src/js/L3Side.js";
import Tables from "lamejs/src/js/Tables.js";
import BitStream from "lamejs/src/js/BitStream.js";

/**
 * lamejs (Version 1.2.1) hat einen Fehler im eigenen Paket: mehrere interne Dateien
 * (Lame.js, BitStream.js, Encoder.js, PsyModel.js, Quantize.js, QuantizePVT.js, Presets.js,
 * VBRTag.js) verwenden Klassen wie "MPEGMode.STEREO" oder "new Lame()", ohne sie selbst per
 * require zu importieren – das funktioniert nur zufällig in Bundlern, die alle CommonJS-Module
 * in einen gemeinsamen Scope zusammenfassen (z. B. Browserify). Unter Vites Browser-Bundling
 * (echtes ESM, jedes Modul sein eigener Scope) fehlen sie alle und es gibt beim ersten
 * "new Mp3Encoder(...)" nacheinander "ReferenceError: X is not defined" für jede betroffene
 * Klasse. Da lamejs selbst nicht gepatcht werden kann (kein postinstall-Patch-Tooling im
 * Projekt), werden hier alle betroffenen Klassen einmalig als globale Variablen bereitgestellt –
 * exakt das, was in einem Browserify-Bundle "zufällig" passiert wäre.
 *
 * Muss VOR dem ersten Mp3Encoder-Aufruf importiert werden (siehe use-mic-broadcast.ts).
 */
const globals = globalThis as unknown as Record<string, unknown>;
globals.MPEGMode ??= MPEGMode;
globals.Lame ??= Lame;
globals.GainAnalysis ??= GainAnalysis;
globals.ATH ??= ATH;
globals.LameInternalFlags ??= LameInternalFlags;
globals.MeanBits ??= MeanBits;
globals.CalcNoiseResult ??= CalcNoiseResult;
globals.L3Side ??= L3Side;
globals.Tables ??= Tables;
globals.BitStream ??= BitStream;
