import { createFileRoute } from "@tanstack/react-router";

/**
 * CORS-Proxy für externe Musik-Streams. Ohne diesen Proxy liefert die
 * Web-Audio-Analyse bei fremden Domains nur Stille (getaintetes Audio).
 */
const ALLOWED = [
  "storage.jamendo.com",
  "prod-1.storage.jamendo.com",
  "mp3d.jamendo.com",
  "cdn.freesound.org",
  "freesound.org",
  "archive.org",
  "ia800000.us.archive.org",
  "api.openverse.org",
  "openverse.org",
  "ccmixter.org",
  "files.freemusicarchive.org",
];

const allowed = (host: string) =>
  ALLOWED.some((h) => host === h || host.endsWith(`.${h.split(".").slice(-2).join(".")}`));

/**
 * Titel werden einmal komplett von der Originalquelle geholt und dann gecacht – Range-Anfragen
 * (Puffern, Seek) werden aus diesem Buffer bedient, statt den Range-Header an die Quelle
 * weiterzureichen. Grund: Dienste wie archive.org leiten auf wechselnde Spiegel-Server um; zwei
 * Range-Anfragen für denselben Track können dort auf unterschiedlichen Servern landen und
 * inkonsistente Bytes liefern. Für <audio> sieht das wie eine kaputte Datei aus ("Format error"),
 * die Wiedergabe bricht sofort ab und der Titel wird übersprungen. Ein einmal gecachter,
 * konsistenter Buffer verhindert das zuverlässig.
 */
type CacheEntry = { buffer: Buffer; contentType: string; at: number };
const store = globalThis as unknown as { __audioCache?: Map<string, CacheEntry> };
store.__audioCache ??= new Map();
const cache = store.__audioCache;
const CACHE_MAX = 40;
const CACHE_TTL_MS = 30 * 60_000;

async function fetchFull(url: string): Promise<CacheEntry> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Quelle antwortet mit ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const entry: CacheEntry = {
    buffer,
    contentType: res.headers.get("content-type") ?? "audio/mpeg",
    at: Date.now(),
  };
  cache.set(url, entry);
  if (cache.size > CACHE_MAX) {
    const oldestKey = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
    if (oldestKey) cache.delete(oldestKey);
  }
  return entry;
}

export const Route = createFileRoute("/api/audio")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const raw = new URL(request.url).searchParams.get("url");
        if (!raw) return new Response("url fehlt", { status: 400 });
        let target: URL;
        try {
          target = new URL(raw);
        } catch {
          return new Response("Ungültige URL", { status: 400 });
        }
        if (target.protocol !== "https:" || !allowed(target.hostname)) {
          return new Response("Quelle nicht erlaubt", { status: 403 });
        }

        let entry: CacheEntry;
        try {
          entry = await fetchFull(target.toString());
        } catch {
          return new Response("Stream nicht erreichbar", { status: 502 });
        }

        const { buffer, contentType } = entry;
        const total = buffer.length;
        const headers = new Headers({
          "Content-Type": contentType,
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        });

        const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") ?? "");
        if (range) {
          const start = range[1] ? parseInt(range[1], 10) : 0;
          const end = range[2] ? Math.min(parseInt(range[2], 10), total - 1) : total - 1;
          if (start <= end && start < total) {
            const slice = buffer.subarray(start, end + 1);
            headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
            headers.set("Content-Length", String(slice.length));
            return new Response(new Uint8Array(slice), { status: 206, headers });
          }
        }

        headers.set("Content-Length", String(total));
        return new Response(new Uint8Array(buffer), { status: 200, headers });
      },
    },
  },
});
