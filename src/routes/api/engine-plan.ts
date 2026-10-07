import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/server/auth";
import { editPlan, type PlanEdit, type QueueName } from "@/lib/server/station-engine";

/** Bearbeitung des echten Sendeplans aus der Mehrspur-Ansicht (verschieben, Überlappung, Bett,
 *  entfernen) – siehe editPlan in station-engine.ts. */
export const Route = createFileRoute("/api/engine-plan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });
        const body = (await request.json().catch(() => null)) as
          | (PlanEdit & { queue?: QueueName })
          | null;
        if (!body?.uid || !["move", "overlap", "bed", "remove"].includes(body.action)) {
          return Response.json({ error: "Ungültige Bearbeitung" }, { status: 400 });
        }
        const result = editPlan(body, body.queue === "live" ? "live" : "active");
        return Response.json(result, { status: result.ok ? 200 : 409 });
      },
    },
  },
});
