// Deployment-Ziel: Cloudflare Workers (nicht mehr Node-Server).
// Das Preset `cloudflare_module` baut den Server als ES-Worker-Modul (mit nodejs_compat),
// legt die statischen Assets als Worker-Assets daneben und schreibt automatisch
// .output/server/wrangler.json + .wrangler/deploy/config.json – dadurch genügt
// `npx wrangler deploy` aus dem Projektstamm (exakt der Bereitstellungsbefehl der
// Cloudflare-Builds). Lokal geht `bun run dev` unverändert (Nitro emuliert Workers
// dann über Miniflare/workerd).
//
// HINWEIS: src/server.ts exportiert bereits einen Workers-tauglichen `fetch`-Handler.
import { defineConfig } from "nitro";

// Datenbank auf Workers: Der Supabase-Pooler hat eine private CA, die workerd nicht akzeptiert
// (Node bei `ssl: "require"` prüft nicht, Workers immer) – direkte Verbindungen scheitern daher
// mit "Network connection lost". Lösung: Cloudflare Hyperdrive. Einmalig anlegen:
//   npx wrangler hyperdrive create welle-db --connection-string="<DATABASE_URL>"
// und die ausgegebene ID unten eintragen (oder als Build-Variable HYPERDRIVE_ID setzen).
// Die ID ist kein Geheimnis. Ohne ID läuft alles wie bisher – nur die Datenbank nicht.
const HYPERDRIVE_ID = process.env.HYPERDRIVE_ID ?? "";

export default defineConfig({
  preset: "cloudflare_module",
  cloudflare: {
    // Fixes Ziel-Worker-Name, damit Wrangler immer auf denselben Worker deployed
    // statt einen Namen aus dem Git-Repo-Pfad abzuleiten.
    wrangler: {
      name: "welle-s-dwest-studio",
      ...(HYPERDRIVE_ID
        ? {
            // Lokal (`wrangler dev`) die DB-URL NICHT hier eintragen (landet sonst als Klartext in
            // .output/server/wrangler.json), sondern per Umgebungsvariable
            // CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE setzen.
            hyperdrive: [{ binding: "HYPERDRIVE", id: HYPERDRIVE_ID }],
          }
        : {}),
    },
  },
});
