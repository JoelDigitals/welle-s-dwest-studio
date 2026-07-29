import { useCallback, useEffect, useState } from "react";
import type { MediaRecord } from "@/lib/media-db";

/**
 * Aufnahmen sind privat: der Server filtert /api/media bereits serverseitig auf die eigene
 * Login-Session (andere Accounts sehen fremde Aufnahmen nicht, siehe routes/api/media.ts GET).
 * Anders als die restliche Bibliothek (lokale IndexedDB) kommt diese Liste deshalb bewusst vom
 * Server, nicht aus dem Browser-Speicher – sonst würde ein gemeinsam genutzter Studio-Rechner
 * Aufnahmen zwischen Accounts sichtbar machen.
 */
export function useMyRecordings() {
  const [recordings, setRecordings] = useState<MediaRecord[]>([]);

  const refresh = useCallback(() => {
    fetch("/api/media")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: MediaRecord[]) => setRecordings(list.filter((m) => m.kind === "recording")))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { recordings, refresh };
}
