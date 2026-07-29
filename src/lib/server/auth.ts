import { getSession, updateSession, clearSession } from "@tanstack/react-start/server";

export type AuthedUser = {
  userId: string;
  username: string;
  displayName: string;
  hostId: string | null;
};

/**
 * Verschlüsselte, in TanStack Start eingebaute Session (h3 sealed cookie) – kein eigenes JWT,
 * keine Sessions-Tabelle in der DB nötig. Läuft über den Request-Kontext, der für JEDEN Request
 * (SSR, API-Routen, Server-Functions) gleichermaßen aufgebaut wird.
 */
const sessionConfig = {
  password: process.env.SESSION_SECRET ?? "",
  name: "ws_auth",
  maxAge: 60 * 60 * 24 * 30,
  cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
};

export async function requireAuth(): Promise<AuthedUser | null> {
  if (!sessionConfig.password) return null;
  const session = await getSession<AuthedUser>(sessionConfig);
  return session.data?.userId ? (session.data as AuthedUser) : null;
}

export async function loginSession(user: AuthedUser) {
  await updateSession(sessionConfig, user);
}

export async function logoutSession() {
  await clearSession(sessionConfig);
}
