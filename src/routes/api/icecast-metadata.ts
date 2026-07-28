import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Sendet den aktuellen Titel als Metadaten an einen Icecast-/SHOUTcast-Server
 * (Admin-Schnittstelle), damit im Radionetz der richtige Titel angezeigt wird.
 */
const schema = z.object({
  server: z.string().trim().url(),
  mount: z.string().trim().min(1).max(64),
  user: z.string().trim().max(64).default("admin"),
  password: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(300),
});

export const Route = createFileRoute("/api/icecast-metadata")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Icecast-Zugangsdaten unvollständig." }, { status: 400 });
        }
        const { server, mount, user, password, title } = parsed.data;
        const url = new URL("/admin/metadata", server);
        url.searchParams.set("mode", "updinfo");
        url.searchParams.set("mount", mount.startsWith("/") ? mount : `/${mount}`);
        url.searchParams.set("song", title);

        try {
          const res = await fetch(url, {
            headers: { Authorization: `Basic ${btoa(`${user}:${password}`)}` },
          });
          const text = (await res.text()).slice(0, 300);
          return Response.json({ ok: res.ok, status: res.status, response: text });
        } catch (err) {
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : "Server nicht erreichbar" },
            { status: 502 },
          );
        }
      },
    },
  },
});
