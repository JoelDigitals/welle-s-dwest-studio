import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { HotlineReportType } from "@/lib/broadcast-types";
import { addHotlineReport, listHotlineReports } from "@/lib/server/hotline-store";

/** Hörer-Hotline: alles, was Hörerinnen und Hörer melden oder mitteilen wollen. */
const TYPES = [
  "verkehr",
  "blitzer",
  "wetter",
  "gruss",
  "musikwunsch",
  "lob_kritik",
  "sonstiges",
  "entwarnung",
] as const;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

/** Ort/Straße sind nur bei Verkehr, Blitzer und Entwarnung Pflicht (eine Entwarnung muss die
 *  Stelle nennen, die sie aufhebt, siehe resolveEntwarnung in hotline-store.ts) – bei Gruß,
 *  Musikwunsch etc. reicht die Nachricht. */
const NEEDS_PLACE: readonly HotlineReportType[] = ["verkehr", "blitzer", "entwarnung"];

const schema = z
  .object({
    type: z.enum(TYPES),
    region: z.enum(["Saarland", "Rheinland-Pfalz"]),
    place: z.string().trim().max(80).default(""),
    road: z.string().trim().max(40).default(""),
    message: z.string().trim().min(3).max(400),
    caller: z.string().trim().max(60).default(""),
    contact: z.string().trim().max(120).default(""),
  })
  .refine((data) => !NEEDS_PLACE.includes(data.type) || data.place.length >= 2, {
    message: "Bitte Ort angeben.",
    path: ["place"],
  });

export const Route = createFileRoute("/api/public/hotline")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => {
        const items = await listHotlineReports();
        return Response.json({ items: items.slice(0, 50) }, { headers: cors });
      },
      POST: async ({ request }) => {
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.issues[0]?.message ?? "Bitte alle Felder ausfüllen." },
            { status: 400, headers: cors },
          );
        }
        const report = await addHotlineReport({
          ...parsed.data,
          id: `h${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: Date.now(),
        });
        return Response.json({ ok: true, report }, { headers: cors });
      },
    },
  },
});
