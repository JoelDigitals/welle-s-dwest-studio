import { useCallback, useEffect, useState } from "react";
import type { LiveSlot } from "@/lib/broadcast-types";

export type ScheduledShowInput = {
  title: string;
  hostId: string;
  hostName: string;
  startAt: number;
  minutes: number;
  note?: string;
};

/** Im Voraus geplante Sendetermine – die Engine schaltet dazu automatisch in den Livestudio-Modus
 *  (siehe station-engine.ts – tickScheduledShows) und wieder zurück. */
export function useScheduledShows() {
  const [shows, setShows] = useState<LiveSlot[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/scheduled-shows")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setShows(data);
          setError(null);
        } else if (data?.error) {
          setError(data.error);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const create = useCallback(
    async (input: ScheduledShowInput) => {
      const res = await fetch("/api/scheduled-shows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Anlegen fehlgeschlagen");
        return false;
      }
      refresh();
      return true;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await fetch(`/api/scheduled-shows?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      refresh();
    },
    [refresh],
  );

  return { shows, error, create, remove };
}
