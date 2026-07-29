import { createFileRoute } from "@tanstack/react-router";
import { countUsers, createUser, findUserByUsername } from "@/lib/server/users-store";
import { hashPassword } from "@/lib/server/password";
import { requireAuth, loginSession } from "@/lib/server/auth";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

/**
 * Ohne Login nur erlaubt, wenn noch gar kein Account existiert (Bootstrap des ersten
 * Zugangs). Danach darf nur anlegen, wer schon eingeloggt ist – kein offenes Signup-Formular,
 * aber auch kein separates Admin-Konzept: jede eingeloggte Person darf Kolleg:innen anlegen.
 */
export const Route = createFileRoute("/api/auth/register")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as {
          username?: string;
          password?: string;
          displayName?: string;
          hostId?: string | null;
        } | null;
        if (!body?.username || !body.password || !body.displayName) {
          return Response.json(
            { error: "Nutzername, Passwort und Anzeigename fehlen" },
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
          const existingCount = await countUsers();
          if (existingCount > 0) {
            const requester = await requireAuth();
            if (!requester) {
              return Response.json({ error: "Nicht angemeldet" }, { status: 401, headers: cors });
            }
          }
          const username = body.username.trim().toLowerCase();
          if (await findUserByUsername(username)) {
            return Response.json(
              { error: "Nutzername ist schon vergeben" },
              { status: 409, headers: cors },
            );
          }
          const passwordHash = await hashPassword(body.password);
          const user = await createUser({
            username,
            passwordHash,
            displayName: body.displayName.trim(),
            hostId: body.hostId ?? null,
          });
          // Nach dem allerersten Bootstrap-Account direkt einloggen; danach (Kolleg:in anlegen
          // durch eine bereits eingeloggte Person) bleibt die eigene Session unangetastet.
          if (existingCount === 0) {
            await loginSession({
              userId: user.id,
              username: user.username,
              displayName: user.displayName,
              hostId: user.hostId,
            });
          }
          return Response.json(
            {
              ok: true,
              user: {
                userId: user.id,
                username: user.username,
                displayName: user.displayName,
                hostId: user.hostId,
              },
            },
            { headers: cors },
          );
        } catch (err) {
          console.error("[auth/register] Datenbank nicht erreichbar:", err);
          return Response.json(
            { error: "Datenbank nicht erreichbar – TURSO_DATABASE_URL/TURSO_AUTH_TOKEN gesetzt?" },
            { status: 503, headers: cors },
          );
        }
      },
    },
  },
});
