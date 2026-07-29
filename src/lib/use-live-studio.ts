import { useCallback } from "react";
import type { ItemKind } from "@/lib/broadcast-types";

export type LiveQueueItemInput = {
  kind: ItemKind;
  title: string;
  subtitle: string;
  duration: number;
  text?: string;
  voice?: string;
  hostId?: string;
  hostName?: string;
  mediaId?: string;
  streamUrl?: string;
  license?: string;
  source?: string;
  sponsor?: string | null;
};

/**
 * Schreibende Steuerung fürs Livestudio: Modus umschalten (Autopilot ↔ manuell) und die manuelle
 * Warteschlange befüllen/umsortieren. Die Anzeige (was läuft, was kommt als Nächstes) kommt
 * weiterhin über useLiveBroadcast()/nowplaying – hier geht es nur um die Aktionen, die der Host
 * im Studio auslöst. Alles best-effort (kein Refresh nötig, die nächste Now-Playing-Abfrage zieht
 * den neuen Stand automatisch nach).
 */
export function useLiveStudio() {
  const setLiveMode = useCallback(async (live: boolean) => {
    await fetch("/api/live-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ live }),
    }).catch(() => undefined);
  }, []);

  const addToQueue = useCallback(async (item: LiveQueueItemInput, playNow: boolean) => {
    await fetch("/api/live-queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item, playNow }),
    }).catch(() => undefined);
  }, []);

  const playNow = useCallback((item: LiveQueueItemInput) => addToQueue(item, true), [addToQueue]);
  const cueNext = useCallback((item: LiveQueueItemInput) => addToQueue(item, false), [addToQueue]);

  const remove = useCallback(async (uid: string) => {
    await fetch(`/api/live-queue?uid=${encodeURIComponent(uid)}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  }, []);

  const reorder = useCallback(async (fromUid: string, toUid: string) => {
    await fetch("/api/live-queue", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromUid, toUid }),
    }).catch(() => undefined);
  }, []);

  const skip = useCallback(async () => {
    await fetch("/api/engine-skip", { method: "POST" }).catch(() => undefined);
  }, []);

  return { setLiveMode, playNow, cueNext, remove, reorder, skip };
}
