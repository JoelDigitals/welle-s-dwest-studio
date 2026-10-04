import { useCallback, useEffect, useState } from "react";
import { KeyRound, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Account = {
  id: string;
  username: string;
  displayName: string;
  hostId: string | null;
  createdAt: number;
};

/** Konten des Studios: neue Kolleg:innen anlegen und vergessene Passwörter neu setzen. */
export function AccountsPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [createStatus, setCreateStatus] = useState<string | null>(null);

  const [resetUsername, setResetUsername] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetStatus, setResetStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/users");
      const data = (await res.json()) as { users?: Account[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
      setAccounts(data.users ?? []);
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Konten nicht ladbar");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setCreateStatus(null);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: newUsername,
        displayName: newDisplayName || newUsername,
        password: newPassword,
      }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { error?: string } | null;
    if (!res?.ok) {
      setCreateStatus(data?.error ?? "Anlegen fehlgeschlagen");
      return;
    }
    setCreateStatus(`Konto „${newUsername.trim().toLowerCase()}“ angelegt.`);
    setNewUsername("");
    setNewDisplayName("");
    setNewPassword("");
    void load();
  }

  async function resetAccountPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetStatus(null);
    const res = await fetch("/api/auth/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: resetUsername, password: resetPassword }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { error?: string } | null;
    if (!res?.ok) {
      setResetStatus(data?.error ?? "Zurücksetzen fehlgeschlagen");
      return;
    }
    setResetStatus(`Neues Passwort für „${resetUsername}“ gespeichert.`);
    setResetPassword("");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel space-y-3 p-5 lg:col-span-2">
        <h3 className="display flex items-center gap-2 text-xl">
          <Users className="size-5 text-primary" /> Konten
        </h3>
        {listError && <p className="text-sm text-destructive">{listError}</p>}
        <ul className="divide-y divide-border text-sm">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{a.displayName}</span>{" "}
                <span className="text-muted-foreground">({a.username})</span>
              </span>
              <span className="text-xs text-muted-foreground">
                seit {new Date(a.createdAt).toLocaleDateString("de-DE")}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <form onSubmit={createAccount} className="panel space-y-3 p-5">
        <h3 className="display flex items-center gap-2 text-xl">
          <UserPlus className="size-5 text-primary" /> Neues Konto
        </h3>
        <div className="space-y-1">
          <Label htmlFor="acc-new-username">Nutzername</Label>
          <Input
            id="acc-new-username"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            autoComplete="off"
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="acc-new-display">Anzeigename</Label>
          <Input
            id="acc-new-display"
            value={newDisplayName}
            onChange={(e) => setNewDisplayName(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="acc-new-password">Passwort (mind. 8 Zeichen)</Label>
          <Input
            id="acc-new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <Button type="submit">Konto anlegen</Button>
        {createStatus && <p className="text-sm text-muted-foreground">{createStatus}</p>}
      </form>

      <form onSubmit={resetAccountPassword} className="panel space-y-3 p-5">
        <h3 className="display flex items-center gap-2 text-xl">
          <KeyRound className="size-5 text-primary" /> Passwort zurücksetzen
        </h3>
        <div className="space-y-1">
          <Label htmlFor="acc-reset-username">Konto</Label>
          <select
            id="acc-reset-username"
            value={resetUsername}
            onChange={(e) => setResetUsername(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            required
          >
            <option value="">– Konto wählen –</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.username}>
                {a.displayName} ({a.username})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="acc-reset-password">Neues Passwort (mind. 8 Zeichen)</Label>
          <Input
            id="acc-reset-password"
            type="password"
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <Button type="submit">Passwort speichern</Button>
        {resetStatus && <p className="text-sm text-muted-foreground">{resetStatus}</p>}
      </form>
    </div>
  );
}
