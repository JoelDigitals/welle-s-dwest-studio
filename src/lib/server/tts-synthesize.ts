import { EdgeTTS } from "edge-tts-universal";

/**
 * Sprachsynthese: Gemini zuerst (kostenlos, ausdrucksstärker), bei Überlastung/Fehler automatisch
 * Microsoft Edge TTS (kostenlos, kein Key, kein Kontingent). Wiederverwendbar von der /api/tts-Route
 * und von der Server-Sende-Engine (dort ohne Umweg über einen HTTP-Request an sich selbst).
 */
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview";

// Bildet unsere internen Stimmen-IDs (siehe radio-config.ts) auf die Gemini-Prebuilt-Voices ab.
const VOICE_MAP: Record<string, string> = {
  onyx: "Charon",
  shimmer: "Leda",
  alloy: "Achird",
  nova: "Aoede",
  echo: "Orus",
  coral: "Vindemiatrix",
  ash: "Fenrir",
  sage: "Erinome",
  ballad: "Sulafat",
  verse: "Laomedeia",
};
const DEFAULT_VOICE = "Achird";

// Dieselben Stimmen-IDs auf Microsoft-Edge-TTS-Stimmen abgebildet – kostenlos, kein Key, kein
// Kontingent. Springt automatisch ein, wenn Geminis Freikontingent ausgeschöpft ist.
const EDGE_VOICE_MAP: Record<string, string> = {
  onyx: "de-DE-ConradNeural",
  shimmer: "de-DE-KatjaNeural",
  alloy: "de-DE-FlorianMultilingualNeural",
  nova: "de-DE-AmalaNeural",
  echo: "de-DE-KillianNeural",
  coral: "de-DE-SeraphinaMultilingualNeural",
  ash: "de-AT-JonasNeural",
  sage: "de-AT-IngridNeural",
  ballad: "de-CH-JanNeural",
  verse: "de-CH-LeniNeural",
};
const DEFAULT_EDGE_VOICE = "de-DE-KatjaNeural";
/** Leichte Prosodie-Anpassung pro Rubrik (Edge-TTS kennt keine Freitext-Regieanweisungen). */
const EDGE_RATE: Record<string, string> = {
  traffic: "+8%",
  ad: "+5%",
  weather: "-2%",
};

const STYLES: Record<string, string> = {
  news: "Nachrichtensprache: sachlich, klar akzentuiert, ruhiges aber wachen Tempo, deutliche Betonung der Kernaussagen.",
  traffic:
    "Verkehrsservice: zügig, konzentriert und deutlich, Ortsnamen sauber betonen, leicht drängend.",
  moderation:
    "Lockere Moderation: lächelnd, freundlich, mit natürlichen Betonungswechseln und kleinen Sprechpausen, wie ein Mensch im Studio.",
  weather: "Wetter: freundlich, entspannt, warm, mit leichtem Lächeln in der Stimme.",
  ad: "Werbung: energisch, verkaufsstark, klar.",
};

/** Kurzer Retry bei Überlastung, bevor auf den Edge-TTS-Fallback gewechselt wird. */
const RETRY_DELAYS_MS = [700, 1800];

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let res = await fetch(url, init);
  for (const delay of RETRY_DELAYS_MS) {
    if (res.status !== 429 && res.status !== 503) return res;
    await new Promise((r) => setTimeout(r, delay));
    res = await fetch(url, init);
  }
  return res;
}

// Gemini liefert bei Audio-Antworten rohes PCM (16 bit, meist 24 kHz, mono) statt einer
// fertigen Audiodatei — für <audio>/Blob-Wiedergabe im Browser braucht es einen WAV-Header.
function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bitDepth = 16): Buffer {
  const blockAlign = channels * (bitDepth / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Kostenloser Fallback ohne Freikontingent-Grenze: Microsoft Edge TTS (keine Anmeldung nötig). */
async function synthesizeWithEdgeTts(text: string, voiceId: string, style: string) {
  const voice = EDGE_VOICE_MAP[voiceId] ?? DEFAULT_EDGE_VOICE;
  const rate = EDGE_RATE[style] ?? "+0%";
  const tts = new EdgeTTS(text, voice, { rate });
  const result = await tts.synthesize();
  return Buffer.from(await result.audio.arrayBuffer());
}

export type SynthesizeResult = { buffer: Buffer; contentType: string };

/** Sprachausgabe erzeugen: Gemini, sonst Edge-TTS-Fallback. Wirft nur, wenn beide scheitern. */
export async function synthesizeSpeech(
  rawText: string,
  voiceId: string,
  style: string,
): Promise<SynthesizeResult> {
  const text = rawText.slice(0, 3500);
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    const geminiVoice = VOICE_MAP[voiceId] ?? DEFAULT_VOICE;
    const instruction =
      `Sprich wie eine professionelle deutsche Radiostimme: warm, präsent, nah am Mikrofon, natürliches Atmen und menschliche Betonung – nie monoton oder abgelesen. Halte die Lautstärke über den ganzen Text konstant auf gleichem, kräftigem Pegel (keine leisen Satzenden, kein Flüstern, kein Schreien), damit sich alle Stimmen des Senders gleich laut anhören. ${
        STYLES[style] ?? ""
      }`.trim();

    try {
      const upstream = await fetchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${instruction}\n\nText:\n${text}` }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice } } },
            },
          }),
        },
      );

      if (upstream.ok) {
        const data = (await upstream.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
          }>;
        };
        const inline = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (inline?.data) {
          const pcm = Buffer.from(inline.data, "base64");
          const rateMatch = /rate=(\d+)/.exec(inline.mimeType ?? "");
          const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
          return { buffer: pcmToWav(pcm, sampleRate), contentType: "audio/wav" };
        }
      }
    } catch {
      // Netzwerkfehler etc. → weiter zum Edge-TTS-Fallback.
    }
  }

  const mp3 = await synthesizeWithEdgeTts(text, voiceId, style);
  return { buffer: mp3, contentType: "audio/mpeg" };
}

/**
 * Immer Edge-TTS, nie Gemini: garantiert MP3 (kein WAV) und kein Tageskontingent – wichtig für
 * den durchgehenden Live-Stream (/live-stream), der ein einheitliches Format über
 * Stunden hinweg braucht und niemals wegen einer Kontingent-Grenze aussetzen darf.
 */
export async function synthesizeSpeechMp3Only(
  rawText: string,
  voiceId: string,
  style: string,
): Promise<Buffer> {
  return synthesizeWithEdgeTts(rawText.slice(0, 3500), voiceId, style);
}
