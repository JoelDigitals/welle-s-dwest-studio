import { createFileRoute } from "@tanstack/react-router";
import { forceSkipCurrent } from "@/lib/server/station-engine";
import { requireAuth } from "@/lib/server/auth";

/** Studio-Steuerung: aktuelles Element der echten Sende-Engine sofort beenden. */
export const Route = createFileRoute("/api/engine-skip")({
  server: {
    handlers: {
      POST: async () => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });
        const skipped = forceSkipCurrent();
        return Response.json({ ok: skipped });
      },
    },
  },
});
