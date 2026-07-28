import { createFileRoute } from "@tanstack/react-router";

/** Health-Check für Icecast-/SHOUTcast-Streams. */
export const Route = createFileRoute("/api/streamhealth")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const target = new URL(request.url).searchParams.get("url");
        if (!target || !/^https?:\/\//i.test(target)) {
          return Response.json({ ok: false, error: "Keine gültige Stream-URL." }, { status: 400 });
        }
        const startedAt = Date.now();
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 6000);
          const res = await fetch(target, {
            headers: { "Icy-MetaData": "1", "User-Agent": "WelleSuedwest/1.0" },
            signal: controller.signal,
          });
          clearTimeout(timer);
          const latency = Date.now() - startedAt;
          const type = res.headers.get("content-type") ?? "";
          const listeners = Number(res.headers.get("icy-listeners") ?? "") || null;
          const name = res.headers.get("icy-name");
          const bitrate = Number(res.headers.get("icy-br") ?? "") || null;
          void res.body?.cancel();
          const ok =
            res.ok && (type.includes("audio") || type.includes("ogg") || type.includes("mpeg"));
          return Response.json({
            ok,
            status: res.status,
            latency,
            contentType: type,
            name,
            bitrate,
            listeners,
            checkedAt: new Date().toISOString(),
            error: ok ? null : `Stream antwortet mit ${res.status} (${type || "unbekannt"})`,
          });
        } catch (err) {
          return Response.json({
            ok: false,
            status: 0,
            latency: Date.now() - startedAt,
            checkedAt: new Date().toISOString(),
            error: err instanceof Error ? err.message : "Stream nicht erreichbar",
          });
        }
      },
    },
  },
});
