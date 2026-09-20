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

export default defineConfig({
  preset: "cloudflare_module",
  cloudflare: {
    // Fixes Ziel-Worker-Name, damit Wrangler immer auf denselben Worker deployed
    // statt einen Namen aus dem Git-Repo-Pfad abzuleiten.
    wrangler: {
      name: "welle-s-dwest-studio",
    },
  },
});
