import { useCallback, useEffect, useRef, useState } from "react";
import type { ItemKind, PlanItem } from "@/lib/broadcast-types";

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
 * Warteschlange befüllen/umsortieren. Die Warteschlange selbst (queue) wird hier zusätzlich per
 * Polling geladen – das ist die tatsächliche Live-Warteschlange (state.liveQueue auf dem Server),
 * die der Host schon VOR dem Umschalten in den Livestudio-Modus aufbauen kann. Anders als
 * nowplaying (was gerade wirklich on air ist) bleibt sie immer sichtbar/bearbeitbar, egal ob der
 * Autopilot gerade sendet oder nicht.
 */
export function useLiveStudio() {
  const [queue, setQueue] = useState<PlanItem[]>([]);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const res = await fetch("/api/live-queue");
      if (res.ok) setQueue(await res.json());
    } catch {
      /* nächster Poll versucht es erneut */
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 2000);
    return () => clearInterval(id);
  }, [refresh]);

  const setLiveMode = useCallback(async (live: boolean) => {
    await fetch("/api/live-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ live }),
    }).catch(() => undefined);
  }, []);

  const addToQueue = useCallback(
    async (item: LiveQueueItemInput, playNow: boolean) => {
      await fetch("/api/live-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item, playNow }),
      }).catch(() => undefined);
      void refresh();
    },
    [refresh],
  );

  const playNow = useCallback((item: LiveQueueItemInput) => addToQueue(item, true), [addToQueue]);
  const cueNext = useCallback((item: LiveQueueItemInput) => addToQueue(item, false), [addToQueue]);

  const remove = useCallback(
    async (uid: string) => {
      await fetch(`/api/live-queue?uid=${encodeURIComponent(uid)}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      void refresh();
    },
    [refresh],
  );

  const reorder = useCallback(
    async (fromUid: string, toUid: string) => {
      await fetch("/api/live-queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUid, toUid }),
      }).catch(() => undefined);
      void refresh();
    },
    [refresh],
  );

  const skip = useCallback(async () => {
    await fetch("/api/engine-skip", { method: "POST" }).catch(() => undefined);
    void refresh();
  }, [refresh]);

  return { queue, setLiveMode, playNow, cueNext, remove, reorder, skip };
}
