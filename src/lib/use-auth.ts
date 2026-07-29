import { useCallback, useEffect, useState } from "react";

export type SessionUser = {
  userId: string;
  username: string;
  displayName: string;
  hostId: string | null;
};

/** Aktueller eingeloggter Nutzer, unabhängig vom Route-Context (z. B. für LivePanel). */
export function useAuth() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => setUser(data?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
  }, []);

  return { user, loading, logout };
}
