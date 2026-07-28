import { useQuery } from "@tanstack/react-query";
import type { HotlineReportType } from "./broadcast-types";

export type HotlineReport = {
  id: string;
  type: HotlineReportType;
  region: "Saarland" | "Rheinland-Pfalz";
  place: string;
  road: string;
  message: string;
  caller: string;
  contact: string;
  createdAt: number;
};

export function useHotline() {
  return useQuery({
    queryKey: ["hotline"],
    queryFn: async () => {
      const res = await fetch("/api/public/hotline");
      if (!res.ok) throw new Error(`Hotline nicht erreichbar (${res.status})`);
      return (await res.json()) as { items: HotlineReport[] };
    },
    refetchInterval: 30_000,
  });
}
