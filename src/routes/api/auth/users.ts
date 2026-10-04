import { createFileRoute } from "@tanstack/react-router";
import { listUsers, setUserPassword } from "@/lib/server/users-store";
import { hashPassword } from "@/lib/server/password";
import { requireAuth } from "@/lib/server/auth";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

/**
 * Kontenverwaltung im Studio: Liste aller Accounts (GET) und Passwort zurücksetzen (POST).
 * Gleiche Regel wie beim Anlegen (register.ts): jede eingeloggte Person darf das – es gibt kein
 * separates Admin-Konzept. Wer sich komplett ausgesperrt hat, nutzt scripts/reset-password.mjs.
 */
export const Route = createFileRoute("/api/auth/users")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => {
        const user = await requireAuth();
        if (!user)
          return Response.json({ error: "Nicht angemeldet" }, { status: 401, headers: cors });
        try {
          return Response.json({ users: await listUsers() }, { headers: cors });
        } catch (err) {
          console.error("[auth/users] Datenbank nicht erreichbar:", err);
          return Response.json(
            { error: "Datenbank nicht erreichbar" },
            { status: 503, headers: cors },
          );
        }
      },
      POST: async ({ request }) => {
        const user = await requireAuth();
        if (!user)
          return Response.json({ error: "Nicht angemeldet" }, { status: 401, headers: cors });
        const body = (await request.json().catch(() => null)) as {
          username?: string;
          password?: string;
        } | null;
        if (!body?.username || !body.password) {
          return Response.json(
            { error: "Nutzername und neues Passwort fehlen" },
            { status: 400, headers: cors },
          );
        }
        if (body.password.length < 8) {
          return Response.json(
            { error: "Passwort muss mindestens 8 Zeichen haben" },
            { status: 400, headers: cors },
          );
        }
        try {
          const ok = await setUserPassword(
            body.username.trim().toLowerCase(),
            await hashPassword(body.password),
          );
          if (!ok) {
            return Response.json(
              { error: "Nutzer nicht gefunden" },
              { status: 404, headers: cors },
            );
          }
          return Response.json({ ok: true }, { headers: cors });
        } catch (err) {
          console.error("[auth/users] Datenbank nicht erreichbar:", err);
          return Response.json(
            { error: "Datenbank nicht erreichbar" },
            { status: 503, headers: cors },
          );
        }
      },
    },
  },
});
