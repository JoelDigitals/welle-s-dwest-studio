import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { AdCampaign } from "@/lib/broadcast-types";
import {
  addAdCampaign,
  listAdCampaigns,
  removeAdCampaign,
  updateAdCampaignStatus,
} from "@/lib/server/ad-campaigns-store";
import { requireAuth } from "@/lib/server/auth";

/** Öffentliche Werbe-Bewerbungen: Firmen können sich ohne Studio-Zugang bewerben. */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

const schema = z.object({
  advertiser: z.string().trim().min(2).max(80),
  contact: z.string().trim().max(120).default(""),
  text: z.string().trim().min(10).max(600),
  perHour: z.coerce.number().int().min(1).max(4).default(1),
});

const statusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["eingereicht", "geprueft", "freigegeben", "abgelehnt"]),
});

export const Route = createFileRoute("/api/public/ad-requests")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => Response.json({ items: listAdCampaigns().slice(0, 100) }, { headers: cors }),
      POST: async ({ request }) => {
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.issues[0]?.message ?? "Bitte alle Felder ausfüllen." },
            { status: 400, headers: cors },
          );
        }
        const campaign: AdCampaign = {
          ...parsed.data,
          id: `adreq${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          status: "eingereicht",
          createdAt: Date.now(),
        };
        addAdCampaign(campaign);
        return Response.json({ ok: true, campaign }, { headers: cors });
      },
      // Studio-Freigabe (Prüfen/Freigeben/Ablehnen) – muss serverseitig ankommen, damit die
      // autonome Sende-Engine freigegebene Werbung auch tatsächlich einplant.
      PATCH: async ({ request }) => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401, headers: cors });
        const parsed = statusSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "id/status ungültig." }, { status: 400, headers: cors });
        }
        const updated = updateAdCampaignStatus(parsed.data.id, parsed.data.status);
        if (!updated) {
          return Response.json({ error: "Nicht gefunden." }, { status: 404, headers: cors });
        }
        return Response.json({ ok: true, campaign: updated }, { headers: cors });
      },
      DELETE: async ({ request }) => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401, headers: cors });
        const id = new URL(request.url).searchParams.get("id");
        if (!id) return Response.json({ error: "id fehlt." }, { status: 400, headers: cors });
        removeAdCampaign(id);
        return Response.json({ ok: true }, { headers: cors });
      },
    },
  },
});
