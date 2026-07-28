import type { AdCampaign } from "@/lib/broadcast-types";

/**
 * Serverseitiger Speicher für Werbe-Bewerbungen (öffentlich über /werbung eingereicht oder im
 * Studio angelegt). Einziges Modul, das globalThis.__adRequests anfasst – Route-Handler und
 * Server-Sende-Engine lesen/schreiben ausschließlich über diese Funktionen.
 */
const store = globalThis as unknown as { __adRequests?: AdCampaign[] };
store.__adRequests ??= [];

export function listAdCampaigns(): AdCampaign[] {
  return store.__adRequests ?? [];
}

export function listApprovedAdCampaigns(): AdCampaign[] {
  return listAdCampaigns().filter((c) => c.status === "freigegeben");
}

export function addAdCampaign(campaign: AdCampaign) {
  store.__adRequests = [campaign, ...listAdCampaigns()].slice(0, 200);
  return campaign;
}

export function updateAdCampaignStatus(
  id: string,
  status: AdCampaign["status"],
): AdCampaign | null {
  const list = listAdCampaigns();
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const updated = { ...list[idx], status };
  list[idx] = updated;
  store.__adRequests = list;
  return updated;
}

export function removeAdCampaign(id: string) {
  store.__adRequests = listAdCampaigns().filter((c) => c.id !== id);
}
