import { useQuery } from "@tanstack/react-query";
import type { NewsFeedItem, TrafficFeedItem } from "./broadcast-types";

type NewsResponse = {
  fetchedAt: string;
  items: NewsFeedItem[];
  errors: Array<{ source: string; error: string }>;
};
type TrafficResponse = {
  fetchedAt: string;
  items: TrafficFeedItem[];
  errors: Array<{ road: string; error: string }>;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Feed-Abruf fehlgeschlagen (${res.status})`);
  return (await res.json()) as T;
}

export function useNewsFeed() {
  return useQuery({
    queryKey: ["news"],
    queryFn: () => fetchJson<NewsResponse>("/api/news?limit=6"),
    refetchInterval: 10 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });
}

export function useTrafficFeed() {
  return useQuery({
    queryKey: ["traffic"],
    queryFn: () => fetchJson<TrafficResponse>("/api/traffic"),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 3 * 60 * 1000,
  });
}
