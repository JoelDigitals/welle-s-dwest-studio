import { createFileRoute } from "@tanstack/react-router";
import { startStationEngine } from "@/lib/server/station-engine";
import { requireAuth } from "@/lib/server/auth";

/**
 * Echtzeit-Status des Senders. Das Studio meldet per POST, was gerade läuft,
 * Webplayer, Encoder (Icecast/RDS) und Websites lesen per GET.
 *
 * Startet hier (statt in server.ts) die autonome Sende-Engine: API-Routen laufen bei Nitro
 * über einen eigenen Dispatch-Pfad, der server.ts nicht durchläuft. startStationEngine() ist
 * idempotent, das Modul hier wird beim ersten GET/POST auf diese Route ohnehin geladen.
 */
startStationEngine();
export type NowPlaying = {
  station: string;
  show: string | null;
  host: string | null;
  kind: string | null;
  title: string | null;
  subtitle: string | null;
  /** Eindeutige ID des Sendeplan-Elements – der Webplayer erkennt daran einen Wechsel. */
  uid: string | null;
  startedAt: number | null;
  duration: number;
  /** Grobe Schätzung, wie lange das Intro eines Musiktitels instrumental sein dürfte (0 bei
   *  Nicht-Musik) – Richtwert für die clientseitige Überblendung, keine echte Gesangserkennung. */
  introSeconds: number;
  elapsed: number;
  onAir: boolean;
  /** Livestudio-Modus aktiv? Dann sendet nur die manuelle Warteschlange, der Autopilot pausiert. */
  live: boolean;
  streamUrl: string | null;
  next: Array<{
    uid: string;
    kind: string;
    title: string;
    subtitle: string;
    duration: number;
    introSeconds: number;
    plannedAt: number;
  }>;
  updatedAt: number;
};

const empty: NowPlaying = {
  station: "Welle Südwest",
  show: null,
  host: null,
  kind: null,
  title: null,
  subtitle: null,
  uid: null,
  startedAt: null,
  duration: 0,
  introSeconds: 0,
  elapsed: 0,
  onAir: false,
  live: false,
  streamUrl: null,
  next: [],
  updatedAt: 0,
};

const globalStore = globalThis as unknown as { __nowPlaying?: NowPlaying };
globalStore.__nowPlaying ??= empty;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "no-store",
};

export const Route = createFileRoute("/api/public/nowplaying")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () => Response.json(globalStore.__nowPlaying ?? empty, { headers: cors }),
      POST: async ({ request }) => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401, headers: cors });
        const body = (await request.json().catch(() => null)) as Partial<NowPlaying> | null;
        if (!body)
          return Response.json({ error: "Ungültige Daten" }, { status: 400, headers: cors });
        const state: NowPlaying = {
          ...empty,
          ...globalStore.__nowPlaying,
          ...body,
          station: "Welle Südwest",
          next: Array.isArray(body.next) ? body.next.slice(0, 60) : [],
          updatedAt: Date.now(),
        };
        globalStore.__nowPlaying = state;
        return Response.json({ ok: true }, { headers: cors });
      },
    },
  },
});
