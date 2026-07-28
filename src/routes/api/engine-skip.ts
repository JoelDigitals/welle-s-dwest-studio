import { createFileRoute } from "@tanstack/react-router";
import { forceSkipCurrent } from "@/lib/server/station-engine";

/** Studio-Steuerung: aktuelles Element der echten Sende-Engine sofort beenden. */
export const Route = createFileRoute("/api/engine-skip")({
  server: {
    handlers: {
      POST: async () => {
        const skipped = forceSkipCurrent();
        return Response.json({ ok: skipped });
      },
    },
  },
});
