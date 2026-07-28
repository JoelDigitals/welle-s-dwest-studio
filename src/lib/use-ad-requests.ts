import { useQuery } from "@tanstack/react-query";
import type { AdCampaign } from "./broadcast-types";

/** Öffentlich eingereichte Werbe-Bewerbungen (/werbung), unabhängig vom Studio-Zugang. */
export function useAdRequests() {
  return useQuery({
    queryKey: ["ad-requests"],
    queryFn: async () => {
      const res = await fetch("/api/public/ad-requests");
      if (!res.ok) throw new Error(`Werbeanfragen nicht erreichbar (${res.status})`);
      return (await res.json()) as { items: AdCampaign[] };
    },
    refetchInterval: 30_000,
  });
}
