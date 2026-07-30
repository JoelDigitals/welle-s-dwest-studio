import { createFileRoute } from "@tanstack/react-router";
import { findUserByUsername } from "@/lib/server/users-store";
import { verifyPassword } from "@/lib/server/password";
import { loginSession } from "@/lib/server/auth";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as {
          username?: string;
          password?: string;
        } | null;
        if (!body?.username || !body.password) {
          return Response.json(
            { error: "Nutzername und Passwort fehlen" },
            { status: 400, headers: cors },
          );
        }
        try {
          const user = await findUserByUsername(body.username.trim().toLowerCase());
          if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
            return Response.json(
              { error: "Nutzername oder Passwort falsch" },
              { status: 401, headers: cors },
            );
          }
          await loginSession({
            userId: user.id,
            username: user.username,
            displayName: user.displayName,
            hostId: user.hostId,
          });
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
          console.error("[auth/login] Datenbank nicht erreichbar:", err);
          return Response.json(
            { error: "Datenbank nicht erreichbar – DATABASE_URL gesetzt?" },
            { status: 503, headers: cors },
          );
        }
      },
    },
  },
});
