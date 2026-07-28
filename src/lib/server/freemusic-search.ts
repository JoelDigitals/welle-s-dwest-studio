import type { FreeTrack } from "@/lib/broadcast-types";

/**
 * Freie Musik aus dem Netz: Netlabel-Alben im Internet Archive, mit Openverse als Ausweichquelle.
 * Wiederverwendbar von der /api/freemusic-Route und von der Server-Sende-Engine.
 */
type Doc = {
  identifier: string;
  title?: string;
  creator?: string | string[];
  licenseurl?: string;
  subject?: string | string[];
};

type MetaFile = { name: string; format?: string; length?: string; title?: string };

const first = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);

/** fetch mit Timeout – ein einzelner hängender Request darf die Suche nie blockieren. */
async function fetchWithTimeout(url: string | URL, ms: number, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function openverse(q: string, limit: number): Promise<FreeTrack[]> {
  const api = new URL("https://api.openverse.org/v1/audio/");
  api.searchParams.set("q", q);
  api.searchParams.set("page_size", String(limit));
  api.searchParams.set("license_type", "commercial,modification");
  api.searchParams.set("category", "music");
  const res = await fetchWithTimeout(api, 6000, { headers: { accept: "application/json" } });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: Array<{
      id: string;
      title?: string;
      creator?: string;
      url?: string;
      duration?: number;
      license?: string;
      license_version?: string;
      foreign_landing_url?: string;
    }>;
  };
  return (data.results ?? [])
    .filter((r) => Boolean(r.url))
    .map((r) => ({
      id: r.id,
      title: r.title?.trim() || "Ohne Titel",
      artist: r.creator?.trim() || "Unbekannt",
      category: q,
      duration: Math.round((r.duration ?? 0) / 1000) || 180,
      streamUrl: `/api/audio?url=${encodeURIComponent(r.url as string)}`,
      license: `CC ${(r.license ?? "by").toUpperCase()} ${r.license_version ?? ""}`.trim(),
      source: r.foreign_landing_url ?? "openverse.org",
    }));
}

function licenseLabel(url?: string) {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes("/nc") || u.includes("-nc") || u.includes("-nd")) return null;
  if (u.includes("publicdomain") || u.includes("zero")) return "CC0 / Public Domain";
  const m = u.match(/licenses\/([a-z-]+)\/([\d.]+)/);
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : null;
}

function seconds(len?: string) {
  if (!len) return 0;
  if (len.includes(":")) {
    const parts = len.split(":").map(Number);
    return parts.reduce((acc, p) => acc * 60 + (Number.isFinite(p) ? p : 0), 0);
  }
  return Math.round(Number(len) || 0);
}

export async function searchFreeMusic(rawSubject: string, limit: number): Promise<FreeTrack[]> {
  const subject = (rawSubject || "pop").slice(0, 40).replace(/[^\w\s-]/g, "");
  const clampedLimit = Math.min(20, Math.max(1, limit));

  try {
    const search = new URL("https://archive.org/advancedsearch.php");
    search.searchParams.set(
      "q",
      `collection:netlabels AND mediatype:audio AND subject:(${subject}) ` +
        `AND licenseurl:(*by*) AND NOT licenseurl:(*nc* OR *nd*)`,
    );
    for (const f of ["identifier", "title", "creator", "licenseurl", "subject"]) {
      search.searchParams.append("fl[]", f);
    }
    search.searchParams.set("rows", "30");
    search.searchParams.set("output", "json");

    const res = await fetchWithTimeout(search, 6000, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { response?: { docs?: Doc[] } };
    const docs = (data.response?.docs ?? []).filter((d) => licenseLabel(d.licenseurl));

    const load = async (doc: Doc): Promise<FreeTrack | null> => {
      try {
        const meta = (await (
          await fetchWithTimeout(`https://archive.org/metadata/${doc.identifier}`, 4000)
        ).json()) as { files?: MetaFile[] };
        const file = (meta.files ?? [])
          .filter((f) => /mp3/i.test(f.format ?? "") && /\.mp3$/i.test(f.name))
          .map((f) => ({ ...f, secs: seconds(f.length) }))
          .find((f) => f.secs >= 90 && f.secs <= 360);
        if (!file) return null;
        const url = `https://archive.org/download/${doc.identifier}/${encodeURIComponent(file.name)}`;
        return {
          id: `${doc.identifier}/${file.name}`,
          title: (file.title || doc.title || "Ohne Titel").trim(),
          artist: (first(doc.creator) || "Netlabel-Künstler").trim(),
          category: subject,
          duration: file.secs,
          streamUrl: `/api/audio?url=${encodeURIComponent(url)}`,
          license: licenseLabel(doc.licenseurl) ?? "CC BY",
          source: `archive.org/details/${doc.identifier}`,
        };
      } catch {
        return null;
      }
    };

    const deadline = Date.now() + 9000;
    const items: FreeTrack[] = [];
    for (
      let i = 0;
      i < docs.length && items.length < clampedLimit && Date.now() < deadline;
      i += 6
    ) {
      const wave = await Promise.all(docs.slice(i, i + 6).map(load));
      for (const t of wave) if (t) items.push(t);
    }

    return items.length ? items.slice(0, clampedLimit) : await openverse(subject, clampedLimit);
  } catch {
    return openverse(subject, clampedLimit).catch(() => []);
  }
}
