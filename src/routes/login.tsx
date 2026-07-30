import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [bootstrap, setBootstrap] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data?.user) {
          navigate({ to: "/" });
          return;
        }
        if (data?.dbError) {
          setError("Datenbank nicht erreichbar – DATABASE_URL gesetzt?");
        }
        setBootstrap(Boolean(data?.bootstrapNeeded));
      })
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(bootstrap ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          bootstrap ? { username, password, displayName } : { username, password },
        ),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Anmeldung fehlgeschlagen");
        return;
      }
      navigate({ to: "/" });
    } catch {
      setError("Verbindung fehlgeschlagen");
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Lade…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2 text-primary">
            <Radio className="h-5 w-5" />
            <span className="text-sm font-semibold tracking-tight">Welle Südwest</span>
          </div>
          <CardTitle>{bootstrap ? "Ersten Account anlegen" : "Anmelden"}</CardTitle>
          <CardDescription>
            {bootstrap
              ? "Es gibt noch keinen Zugang zum Studio – lege den ersten Account an."
              : "Melde dich an, um das Studio zu senden."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {bootstrap && (
              <div className="space-y-2">
                <Label htmlFor="displayName">Anzeigename</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Dein Name"
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="username">Nutzername</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passwort</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={bootstrap ? "new-password" : "current-password"}
                minLength={bootstrap ? 8 : undefined}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Bitte warten…" : bootstrap ? "Account anlegen" : "Anmelden"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
