// Zwei Deployment-Ziele aus demselben Code:
//
// 1. Render.com (Node-Server) – Render setzt beim Build automatisch die Variable RENDER, dann wird
//    ein normaler Node-Server gebaut (`node .output/server/index.mjs`). Hier läuft die autonome
//    Sende-Engine (station-engine.ts) dauerhaft im Prozess.
//
// 2. Cloudflare Workers – Preset `cloudflare_module` baut ein ES-Worker-Modul (mit nodejs_compat)
//    und schreibt .output/server/wrangler.json + .wrangler/deploy/config.json, dadurch genügt
//    `npx wrangler deploy`. Workers können KEINEN dauerhaft laufenden Prozess halten (Timer laufen
//    nur während eines Requests, jedes Isolate hat seinen eigenen Speicher, und auf dem Free-Plan
//    gibt es nur 10 ms CPU je Aufruf) – die Sende-Engine kann dort also nicht laufen. Darum werden
//    alle Engine-Routen (Live-Stream, Now-Playing, Live-Modus, Warteschlange, ...) unten per
//    Proxy an die Render-Instanz weitergereicht: ein Sender, eine Engine, zwei Frontends.
//    Alles andere (Studio-Seiten, Login, Datenbank-Routen) läuft direkt auf dem Worker.
//
// Bei einem Build für einen anderen Host lässt sich das Ziel per NITRO_PRESET erzwingen.
import { defineConfig } from "nitro";

const PRESET =
  process.env.NITRO_PRESET || (process.env.RENDER ? "render_com" : "cloudflare_module");
const isCloudflare = PRESET.startsWith("cloudflare");

// Datenbank auf Workers: Der Supabase-Pooler hat eine private CA, die workerd nicht akzeptiert
// (Node bei `ssl: "require"` prüft nicht, Workers immer) – direkte Verbindungen scheitern daher
// mit "Network connection lost". Lösung: Cloudflare Hyperdrive (kostenlos im Free-Plan). Einmalig:
//   npx wrangler hyperdrive create welle-db --caching-disabled --connection-string="<URL>"
// mit dem SESSION-Pooler (Port 5432 statt 6543) und die ausgegebene ID hier eintragen (oder als
// Build-Variable HYPERDRIVE_ID setzen). Die ID ist kein Geheimnis. Caching bleibt aus, sonst
// zeigt das Studio bis zu 60 s alte Daten (z. B. ein gerade angelegter Sendetermin fehlt noch).
const HYPERDRIVE_ID = process.env.HYPERDRIVE_ID ?? "8e7bfe60308042c7a65c2ebde1f4a996";

// Wo die Sende-Engine läuft (Render). Auf Cloudflare werden die Engine-Routen dorthin
// weitergeleitet. Leer setzen (ENGINE_ORIGIN=""), um das zu deaktivieren.
const ENGINE_ORIGIN = (
  process.env.ENGINE_ORIGIN ?? "https://welle-sued-west-studio.onrender.com"
).replace(/\/+$/, "");

// Alle Routen, die den In-Memory-Zustand der Sende-Engine lesen oder ändern (= alles, was
// src/lib/server/station-engine.ts importiert), plus Routen mit eigenem flüchtigem Speicher, den
// die Engine mitnutzt (Werbebuchungen, gleichzeitige Hörer) – auf Workers wäre der je Isolate leer.
// Ebenfalls an Render: Sprachausgabe (Edge-TTS braucht Node-WebSockets – auf Workers "The
// options.createConnection option is not implemented"), Bibliotheks-Uploads (liegen im Dateisystem
// des Render-Servers, wo die Engine sie liest) und der Musik-Proxy (puffert komplette MP3s).
const ENGINE_ROUTES = [
  "/api/tts",
  "/api/media",
  "/api/audio",
  "/api/public/ad-requests",
  "/api/public/listener-event",
  "/api/public/listener-stats",
  "/live-stream",
  "/api/daily-theme",
  "/api/engine-skip",
  "/api/live-mode",
  "/api/live-queue",
  "/api/mic-stream",
  "/api/public/news-page",
  "/api/public/nowplaying",
  "/api/public/onair-audio",
  "/api/public/traffic-overview",
];

export default defineConfig({
  preset: PRESET,
  ...(isCloudflare && ENGINE_ORIGIN
    ? {
        routeRules: Object.fromEntries(
          ENGINE_ROUTES.map((route) => [route, { proxy: `${ENGINE_ORIGIN}${route}` }]),
        ),
      }
    : {}),
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
