import { useQuery } from "@tanstack/react-query";
import { curateFreeMusic, FREE_MUSIC_QUERIES } from "./free-music-pool";
import type { FreeTrack } from "./broadcast-types";

type FreeMusicResponse = { items: FreeTrack[]; error?: string };

async function search(q: string) {
  // cache: "no-store" ist bewusst: alte, im Browser gecachte Antworten haben tote/veraltete
  // Stream-URLs enthalten (z. B. von einer früheren Quelle), was beim Abspielen als
  // "Format error"/NotSupportedError auffiel. Die Suche ist serverseitig schnell genug, dass
  // ein frischer Abruf pro Aufruf kein Problem ist.
  const res = await fetch(`/api/freemusic?q=${encodeURIComponent(q)}&limit=10`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Musiksuche fehlgeschlagen (${res.status})`);
  return ((await res.json()) as FreeMusicResponse).items ?? [];
}

/**
 * Musikpool aus frei nutzbarer (CC-lizenzierter) Musik.
 * Es werden ausschließlich kommerziell nutzbare Lizenzen übernommen.
 */
export function useFreeMusicPool() {
  return useQuery({
    queryKey: ["freemusic-pool"],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const lists = await Promise.all(
        FREE_MUSIC_QUERIES.map((q) => search(q).catch(() => [] as FreeTrack[])),
      );
      return curateFreeMusic(lists.flat());
    },
  });
}
