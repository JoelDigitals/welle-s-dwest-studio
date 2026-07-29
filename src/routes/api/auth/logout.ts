import { createFileRoute } from "@tanstack/react-router";
import { logoutSession } from "@/lib/server/auth";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async () => {
        await logoutSession();
        return Response.json({ ok: true }, { headers: cors });
      },
    },
  },
});
