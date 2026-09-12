import { useEffect, useState } from "react";

export type ListenerStats = {
  concurrent: number;
  playsToday: number;
  playsLast7Days: number;
  byDay: Array<{ day: string; count: number }>;
};

/** Nur fürs Studio (intern) - die öffentliche Website zeigt die Zahl bewusst NICHT (siehe
 *  /api/public/listener-stats), solange die Reichweite noch klein ist, sieht "0 Hörer" dort
 *  schlecht aus. Intern ist die Zahl aber nützlich fürs Team. */
export function useListenerStats() {
  const [stats, setStats] = useState<ListenerStats | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/public/listener-stats");
        if (!res.ok) return;
        const data = (await res.json()) as ListenerStats;
        if (active) setStats(data);
      } catch {
        /* nächster Versuch beim folgenden Intervall */
      }
    };
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  return stats;
}
