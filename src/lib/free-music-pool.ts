import { isCommerciallyUsable } from "./planner";
import type { FreeTrack } from "./broadcast-types";

/**
 * Musikfarbe: moderner Pop, Dance und Charts-Sound – kein Psychedelic/Stoner/Experimental.
 * Isomorphe, reine Kuratierungslogik – vom Client-Hook (useFreeMusicPool) und von der
 * Server-Sende-Engine gleichermaßen genutzt, damit beide dieselbe Musikfarbe wählen.
 */
export const FREE_MUSIC_QUERIES = ["pop", "dance", "electropop", "indie pop"];

/** Genres/Titel, die nicht ins Formatradio passen. */
const BLOCK =
  /(psychedel|stoner|doom|drone|noise|experimental|field recording|ambient|meditat|spoken|podcast|lecture|sermon|classical|baroque|opera|choir|jazz standard|metal|hardcore|black metal|grindcore|dark|ritual|soundscape|sound effect|loop pack|karaoke|8-?bit|chiptune|space rock|prog rock)/i;

/** Klar erwünschte Farben. */
const PREFER = /(pop|dance|electro|house|indie|rnb|r&b|soul|funk|charts|radio|vocal|synth)/i;

/** Aus rohen Suchergebnissen (mehrerer Queries) den kommerziell nutzbaren, formatpassenden Pool bauen. */
export function curateFreeMusic(raw: FreeTrack[]): FreeTrack[] {
  const seen = new Set<string>();
  const tracks: FreeTrack[] = [];
  for (const item of raw) {
    if (seen.has(item.id) || !isCommerciallyUsable(item.license)) continue;
    if (item.duration < 90 || item.duration > 360) continue;
    const tag = `${item.title} ${item.artist} ${item.category}`;
    if (BLOCK.test(tag)) continue;
    seen.add(item.id);
    tracks.push(item);
  }
  return tracks.sort((a, b) => {
    const sa = PREFER.test(`${a.category} ${a.title}`) ? 0 : 1;
    const sb = PREFER.test(`${b.category} ${b.title}`) ? 0 : 1;
    return sa - sb;
  });
}
