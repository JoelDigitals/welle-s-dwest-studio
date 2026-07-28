import { useCallback, useEffect, useState } from "react";
import {
  deleteMedia,
  listMedia,
  putMedia,
  readAudioDuration,
  type MediaKind,
  type MediaRecord,
} from "./media-db";

export type UploadMeta = {
  kind: MediaKind;
  title?: string;
  artist?: string;
  category?: string;
  runFrom?: number;
  runUntil?: number;
  perHour?: number;
  sponsorOf?: MediaRecord["sponsorOf"];
  slot?: MediaRecord["slot"];
};

export type OnlineTrack = {
  id: string;
  title: string;
  artist: string;
  category: string;
  duration: number;
  streamUrl: string;
  license: string;
  source: string;
};

export function useMediaLibrary() {
  const [media, setMedia] = useState<MediaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMedia(await listMedia());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Medienbibliothek nicht verfügbar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upload = useCallback(
    async (files: File[], meta: UploadMeta) => {
      for (const file of files) {
        const duration = await readAudioDuration(file);
        await putMedia({
          id: `${meta.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: meta.kind,
          title: meta.title?.trim() || file.name.replace(/\.[^.]+$/, ""),
          artist: meta.artist?.trim() || "",
          category: meta.category?.trim() || "Allgemein",
          duration: duration || 180,
          fileName: file.name,
          mimeType: file.type || "audio/mpeg",
          createdAt: Date.now(),
          runFrom: meta.runFrom,
          runUntil: meta.runUntil,
          perHour: meta.perHour,
          sponsorOf: meta.sponsorOf ?? null,
          slot: meta.slot ?? null,
          blob: file,
        });
      }
      await refresh();
    },
    [refresh],
  );

  /** Freie Musik aus dem Netz (CC-Lizenz) in die Playlist übernehmen. */
  const addOnline = useCallback(
    async (track: OnlineTrack) => {
      await putMedia({
        id: `online-${track.id}`,
        kind: "music",
        title: track.title,
        artist: track.artist,
        category: track.category,
        duration: track.duration || 180,
        fileName: track.streamUrl.split("/").pop() ?? track.title,
        mimeType: "audio/mpeg",
        createdAt: Date.now(),
        sponsorOf: null,
        slot: null,
        streamUrl: track.streamUrl,
        license: track.license,
        source: track.source,
      });
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteMedia(id);
      await refresh();
    },
    [refresh],
  );

  return { media, loading, error, refresh, upload, addOnline, remove };
}
