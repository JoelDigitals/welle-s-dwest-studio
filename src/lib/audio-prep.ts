import { getMedia, getTts, putTts, ttsHash } from "./media-db";
import type { PlanItem } from "./broadcast-types";

const urlCache = new Map<string, string>();

function urlFor(key: string, blob: Blob) {
  const existing = urlCache.get(key);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

export type PrepResult = { audioUrl: string; fromCache: boolean };

/**
 * Moderationstexte kommen aus festen Phrasen-Bausteinen (planner.ts) – klingt sonst schnell
 * nach Vorlage statt nach Mensch. Vor der Sprachausgabe lässt die KI den Baustein frei in
 * Ich-Perspektive umformulieren. Schlägt das fehl (kein Key, Rate-Limit, offline), wird
 * einfach der Original-Text gesprochen – die Sendung bleibt lauffähig.
 */
async function humanizeModeration(text: string, hostName?: string): Promise<string> {
  try {
    const res = await fetch("/api/script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "Moderation (frei umformulieren)",
        hostName: hostName ?? "Alex",
        brief: text,
      }),
    });
    if (!res.ok) return text;
    const data = (await res.json().catch(() => null)) as { text?: string } | null;
    return data?.text?.trim() || text;
  } catch {
    return text;
  }
}

/**
 * Verkehrsblöcke (offizielle Feed-Meldungen und Hörer-Hinweise aus der Hotline) werden wie die
 * Moderation vor der Sprachausgabe geglättet – aber mit dem faktentreuen Verkehrsfunk-Prompt
 * (Straßen, Orte und Angaben bleiben exakt). Schlägt das fehl, wird der Original-Text gesprochen.
 */
async function humanizeTraffic(text: string): Promise<string> {
  try {
    const res = await fetch("/api/script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "Verkehr (faktengetreu umformulieren)",
        brief: text,
      }),
    });
    if (!res.ok) return text;
    const data = (await res.json().catch(() => null)) as { text?: string } | null;
    return data?.text?.trim() || text;
  } catch {
    return text;
  }
}

/**
 * Erzeugt bzw. lädt das Audio eines Plan-Elements.
 * Sprechtexte werden einmal generiert und 48 Stunden lang wiederverwendet.
 */
export async function prepareItem(item: PlanItem): Promise<PrepResult> {
  if (item.mediaId) {
    const rec = await getMedia(item.mediaId);
    if (!rec) throw new Error("Datei nicht in der Medienbibliothek gefunden.");
    if (rec.blob) return { audioUrl: urlFor(`m:${rec.id}`, rec.blob), fromCache: true };
    if (rec.streamUrl) return { audioUrl: rec.streamUrl, fromCache: true };
    throw new Error("Kein Audio zu diesem Bibliothekseintrag.");
  }

  if (item.streamUrl) {
    // Direkt als <audio>-Netzwerkquelle gesetzt, brechen Streams von externen Anbietern
    // (archive.org & Co.) mit "Format error" ab, obwohl die Bytes beim Abruf per fetch()
    // einwandfrei sind – der Abspielpfad des Audio-Elements verträgt das nicht zuverlässig.
    // Fix: einmal per fetch() vollständig laden (das funktioniert nachweislich) und als
    // Blob/Object-URL abspielen, genau wie bereits bei den TTS-Audios.
    const key = `s:${item.streamUrl}`;
    const existing = urlCache.get(key);
    if (existing) return { audioUrl: existing, fromCache: true };
    const res = await fetch(item.streamUrl);
    if (!res.ok) throw new Error(`Musik-Stream nicht erreichbar (${res.status}).`);
    const blob = await res.blob();
    return { audioUrl: urlFor(key, blob), fromCache: false };
  }

  const text = item.text?.trim();
  if (!text) throw new Error("Kein Audio und kein Sprechtext hinterlegt.");
  const voice = item.voice ?? "alloy";
  const style = item.kind;
  // Cache-Schlüssel bewusst auf dem Original-Baustein, nicht der KI-Umformulierung: so wird
  // für ein und denselben Baustein nur einmal humanisiert/gesprochen (48h-Wiederverwendung),
  // statt bei jedem Abspielen erneut die KI zu bemühen.
  const hash = await ttsHash(text, `${voice}:${style}`);

  const cached = await getTts(hash).catch(() => null);
  if (cached) return { audioUrl: urlFor(`t:${hash}`, cached.blob), fromCache: true };

  const spokenText =
    item.kind === "moderation"
      ? await humanizeModeration(text, item.hostName)
      : item.kind === "traffic"
        ? await humanizeTraffic(text)
        : text;

  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: spokenText, voice, style }),
  });
  if (!res.ok) {
    const info = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(info?.error ?? `Sprachausgabe fehlgeschlagen (${res.status})`);
  }
  const blob = await res.blob();
  await putTts({ hash, voice, text: spokenText, blob }).catch(() => undefined);
  return { audioUrl: urlFor(`t:${hash}`, blob), fromCache: false };
}
