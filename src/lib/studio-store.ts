import type { AdCampaign, LiveSlot } from "./broadcast-types";

function load<T>(key: string): T[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function save<T>(key: string, value: T[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

const AD_KEY = "ws-ad-campaigns";
const LIVE_KEY = "ws-live-slots";

export const loadCampaigns = () => load<AdCampaign>(AD_KEY);
export const saveCampaigns = (c: AdCampaign[]) => save(AD_KEY, c);
export const loadLiveSlots = () => load<LiveSlot>(LIVE_KEY);
export const saveLiveSlots = (s: LiveSlot[]) => save(LIVE_KEY, s);

/** Läuft zu diesem Zeitpunkt eine geplante Livesendung? */
export function liveSlotAt(slots: LiveSlot[] | undefined, at: number) {
  return slots?.find((s) => at >= s.startAt && at < s.startAt + s.minutes * 60_000) ?? null;
}
