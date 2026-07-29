import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/server/auth";
import { countUsers } from "@/lib/server/users-store";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

export const Route = createFileRoute("/api/auth/me")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => {
        const user = await requireAuth();
        if (user) return Response.json({ user, bootstrapNeeded: false }, { headers: cors });
        try {
          const bootstrapNeeded = (await countUsers()) === 0;
          return Response.json({ user: null, bootstrapNeeded }, { headers: cors });
        } catch (err) {
          console.error("[auth/me] Datenbank nicht erreichbar:", err);
          return Response.json(
            { user: null, bootstrapNeeded: false, dbError: true },
            { headers: cors },
          );
        }
      },
    },
  },
});
