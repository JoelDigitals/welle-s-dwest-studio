import { useCallback, useEffect, useState } from "react";
import {
  deleteMedia,
  listMedia,
  putMedia,
  readAudioDuration,
  type MediaKind,
  type MediaRecord,
} from "./media-db";

// Externer Datei-Speicher (JDS Cloud) statt Render: Dateien liegen dauerhaft dort, unabhängig von
// Server-Neustarts/-Deploys. Der Bearer-Token ist ein "anon"-Schlüssel, der laut Dokumentation
// genau für diesen Zweck (Client-seitiger Upload) gedacht ist.
const JDS_CLOUD_UPLOAD_URL = "https://ppkinjwiewiynqgofdcz.supabase.co/functions/v1/upload";
const JDS_CLOUD_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwa2luandpZXdpeW5xZ29mZGN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDY2MTksImV4cCI6MjA5MTQyMjYxOX0.hSU2FfTONOrOZrbBOASoAXlx7W3ePg3tsHj-VaCg-Jo";

/** Datei zu JDS Cloud hochladen, liefert die dauerhafte Download-URL zurück. */
async function uploadToJdsCloud(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(JDS_CLOUD_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${JDS_CLOUD_TOKEN}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Upload zu JDS Cloud fehlgeschlagen (${res.status})`);
  const data = (await res.json()) as {
    success?: boolean;
    file?: { download_url?: string };
  };
  if (!data.success || !data.file?.download_url) {
    throw new Error("JDS Cloud hat keine Download-URL geliefert");
  }
  return data.file.download_url;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Zusätzlich zur lokalen IndexedDB-Bibliothek auf den Server schreiben, damit die autonome
 *  Sende-Engine (läuft server-seitig, hat keinen Zugriff auf Browser-Speicher) eigene Musik/
 *  Jingles tatsächlich verwenden kann. Nur Metadaten + streamUrl (Datei liegt bei JDS Cloud, nicht
 *  auf Render) – der dataBase64-Zweig bleibt nur als Rückfallebene für ältere Einträge mit
 *  lokalem Blob. Bewusst best-effort: schlägt der Server-Sync fehl (offline, Server down), bleibt
 *  die lokale Bibliothek trotzdem nutzbar. */
async function syncMediaToServer(record: MediaRecord) {
  try {
    const { blob, ...meta } = record;
    const dataBase64 = blob && !meta.streamUrl ? await blobToBase64(blob) : undefined;
    await fetch("/api/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta, dataBase64 }),
    });
  } catch {
    /* egal, lokale Bibliothek bleibt trotzdem nutzbar */
  }
}

async function deleteMediaFromServer(id: string) {
  try {
    await fetch(`/api/media?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    /* egal */
  }
}

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
      const list = await listMedia();
      setMedia(list);
      setError(null);
      // Server-Manifest aus der zuverlässigen Browser-Kopie auffrischen – falls es z. B. durch
      // einen Render-Neustart/-Deploy verloren ging (nur Metadaten, keine Dateien, günstig genug
      // für einen Sync bei jedem Öffnen des Studios).
      void Promise.all(list.map((m) => syncMediaToServer(m)));
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
        // Datei geht zu JDS Cloud statt lokal/auf Render gespeichert zu werden – dauerhaft,
        // unabhängig von Server-Neustarts. Die Autopilot-Engine ruft sie später über die
        // zurückgegebene streamUrl ab, genau wie freie Musik aus dem Netz.
        const streamUrl = await uploadToJdsCloud(file);
        const record: MediaRecord = {
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
          streamUrl,
        };
        await putMedia(record);
        // Zusätzlich auf den Server (nur Metadaten + URL), damit die autonome Sende-Engine die
        // Datei auch nutzen kann.
        void syncMediaToServer(record);
      }
      await refresh();
    },
    [refresh],
  );

  /** Freie Musik aus dem Netz (CC-Lizenz) in die Playlist übernehmen. */
  const addOnline = useCallback(
    async (track: OnlineTrack) => {
      const record: MediaRecord = {
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
      };
      await putMedia(record);
      void syncMediaToServer(record);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteMedia(id);
      void deleteMediaFromServer(id);
      await refresh();
    },
    [refresh],
  );

  return { media, loading, error, refresh, upload, addOnline, remove };
}
