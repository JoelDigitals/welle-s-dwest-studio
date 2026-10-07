import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/server/auth";
import { getProductionSnapshot } from "@/lib/server/station-engine";
import { listHotlineReports } from "@/lib/server/hotline-store";
import { isAmbiguousHotline } from "@/lib/planner";
import { CURIOSITY_DAYS } from "@/lib/curiosity-days";
import { berlinClock, berlinDateKey } from "@/lib/berlin-time";
import {
  BLOCK_BUFFER_S,
  MORNING_SLOT,
  TRAFFIC_JINGLE_CUE,
  UNCONFIRMED,
  regionalActionDays,
  type ProductionMeta,
} from "@/lib/station-rules";
import type { PlanItem } from "@/lib/broadcast-types";

/**
 * Produktions-Export nach Regel 5 und 11 (station-rules.ts):
 *   ?format=json   (A) JSON-Timeline – KI-Vorlage, detailliert, inkl. Songs/Jingles und Metadaten
 *   ?format=cue    (B) Live-Cue – kompakt für Moderator:innen (plain text)
 *   ?format=script (C) Skript – lesbar, alle Sprechtexte
 * Grundlage ist der echte Plan der Sende-Engine. Quellen stehen nur in den Metadaten, nie im
 * Sprechtext. Elemente mit editor_needed (von der Engine zurückgehalten) und uneindeutige
 * Hörermeldungen stehen gesammelt in der Redaktions-Liste.
 */
const KIND_LABEL: Record<string, string> = {
  music: "MUSIK",
  jingle: "JINGLE",
  showopener: "OPENER",
  moderation: "MOD",
  news: "NEWS",
  traffic: "VERKEHR",
  weather: "WETTER",
  ad: "WERBUNG",
  slogan: "STATION-ID",
  recording: "AUFNAHME",
  mic: "MIKRO",
};

const HOTLINE_FRESH_MS = 6 * 3600_000;

const clock = (ms: number) => berlinClock(ms);
const iso = (ms: number) => new Date(ms).toISOString();
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function producerShort(day: string) {
  return `Heute ist ${day}. Vorschlag für den Morning-Slot (${MORNING_SLOT.fromHour}–${MORNING_SLOT.toHour} Uhr): als kurze Rubrik oder Hörerfrage aufgreifen, mit lokalem Bezug zu Saarland und Rheinland-Pfalz zuerst.`;
}

async function collect() {
  const snap = getProductionSnapshot();
  const now = Date.now();
  const hotline = await listHotlineReports().catch(() => []);
  const ambiguous = hotline.filter(
    (h) =>
      (h.type === "verkehr" || h.type === "blitzer") &&
      now - h.createdAt < HOTLINE_FRESH_MS &&
      isAmbiguousHotline(h),
  );
  const today = berlinDateKey(now);
  const actionDays = regionalActionDays(CURIOSITY_DAYS[today.slice(5)] ?? []).map((day) => ({
    day,
    slot: `${String(MORNING_SLOT.fromHour).padStart(2, "0")}–${MORNING_SLOT.toHour} Uhr`,
    producer_short: producerShort(day),
  }));
  const editorQueue = [
    ...snap.editorHolds.map((h) => ({
      kind: h.kind,
      title: h.title,
      planned_at: iso(h.plannedAt),
      reason: h.reason,
      text: h.text,
    })),
    ...ambiguous.map((h) => ({
      kind: h.type,
      title: `Hörermeldung ohne Ortsangabe (${h.region})`,
      planned_at: iso(h.createdAt),
      reason: `Uneindeutig – ${UNCONFIRMED}`,
      text: h.message,
    })),
  ];
  return { snap, now, editorQueue, actionDays };
}

function metaOf(item: PlanItem): ProductionMeta {
  return (
    item.meta ?? {
      auto_generated: true,
      sources: [],
      ts: iso(item.plannedAt),
      editor_needed: false,
    }
  );
}

function timelineJson(data: Awaited<ReturnType<typeof collect>>) {
  const { snap, now, editorQueue, actionDays } = data;
  const sources = [...new Set(snap.plan.flatMap((i) => metaOf(i).sources))];
  return {
    meta: {
      auto_generated: true,
      sources,
      ts: iso(now),
      editor_needed: editorQueue.length > 0,
    },
    station: "Welle Süd West",
    mode: snap.liveMode ? "live" : "autopilot",
    buffer_s_per_block: BLOCK_BUFFER_S,
    timeline: snap.plan.map((i) => ({
      uid: i.uid,
      start: iso(i.plannedAt),
      duration_s: Math.round(i.duration),
      kind: i.kind,
      title: i.title,
      subtitle: i.subtitle,
      speaker: i.hostName ?? null,
      hard_start: i.hardStart ? iso(i.hardStart) : null,
      song_slot: Boolean(i.songSlot),
      overlay: i.overlay ?? { overlay: false },
      traffic_jingle_after_announcement: Boolean(i.trafficJingleAfterAnnouncement),
      text: i.text ?? null,
      meta: metaOf(i),
    })),
    editor_queue: editorQueue,
    suggestions: { action_days: actionDays },
  };
}

function liveCue(data: Awaited<ReturnType<typeof collect>>) {
  const { snap, now, editorQueue, actionDays } = data;
  const lines: string[] = [
    `WELLE SÜD WEST – LIVE-CUE (${snap.liveMode ? "Livestudio" : "Autopilot"})`,
    `Stand ${clock(now)} · Puffer je Block ${BLOCK_BUFFER_S.min}–${BLOCK_BUFFER_S.max}s · keine starren Stunden-Trigger`,
    "",
  ];
  for (const i of snap.plan) {
    const label = KIND_LABEL[i.kind] ?? i.kind.toUpperCase();
    const hard = i.hardStart ? " [Zeitmarke]" : "";
    lines.push(
      `${clock(i.plannedAt)}  ${label.padEnd(10)} ${i.title} (${mmss(i.duration)})${hard}`,
    );
    if (i.songSlot) lines.push("          song_slot: true – Song/Jingle flexibel einstreubar");
    if (i.overlay) {
      const from = i.plannedAt - i.overlay.overlay_duration_s * 1000;
      lines.push(
        `          OVERLAY: ${clock(from)}–${clock(i.plannedAt)} — ${i.hostName ?? "Moderator"}: '${(i.text ?? "").trim()}' — Music bed (${i.overlay.ducking_db} dB)`,
      );
    }
    if (i.trafficJingleAfterAnnouncement) lines.push(`          ${TRAFFIC_JINGLE_CUE}`);
    if (i.kind === "news") lines.push("          Kein Bett, keine Titel-Ansage, 30–90s.");
    // Nach jedem Nachrichtenblock (:00/:30) Blockgrenze mit Puffer markieren.
    if (i.kind === "traffic" && i.subtitle.includes("Blitzer")) {
      lines.push(`          — Blockgrenze · Puffer ${BLOCK_BUFFER_S.min}–${BLOCK_BUFFER_S.max}s —`);
    }
  }
  if (editorQueue.length) {
    lines.push("", "REDAKTION (editor_needed – nicht automatisch gesendet):");
    for (const e of editorQueue) lines.push(`- ${e.title}: ${e.reason}`);
  }
  if (actionDays.length) {
    lines.push("", "AKTIONSTAGE (Morning-Slot):");
    for (const a of actionDays) lines.push(`- ${a.day}: ${a.producer_short}`);
  }
  lines.push(
    "",
    `meta: auto_generated=true · ts=${iso(now)} · editor_needed=${editorQueue.length > 0}`,
  );
  return lines.join("\n");
}

function script(data: Awaited<ReturnType<typeof collect>>) {
  const { snap, now, editorQueue } = data;
  const out: string[] = [`WELLE SÜD WEST – SKRIPT`, `Stand ${clock(now)}`, ""];
  for (const i of snap.plan) {
    if (i.kind === "music") {
      out.push(`${clock(i.plannedAt)}  [Musik: ${i.title} – ${i.subtitle.split(" · ")[0]}]`);
      continue;
    }
    if (!i.text) {
      out.push(`${clock(i.plannedAt)}  [${KIND_LABEL[i.kind] ?? i.kind}: ${i.title}]`);
      continue;
    }
    const m = metaOf(i);
    out.push(
      `${clock(i.plannedAt)}  ${i.title} – ${i.hostName ?? ""}${m.tts ? " (TTS)" : ""}`,
      i.text.trim(),
      "",
    );
  }
  if (editorQueue.length) {
    out.push("ZUR PRÜFUNG (nicht gesendet):");
    for (const e of editorQueue) out.push(`- ${e.title} (${e.reason}): ${e.text}`);
  }
  return out.join("\n");
}

export const Route = createFileRoute("/api/production")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await requireAuth();
        if (!user) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });
        const format = new URL(request.url).searchParams.get("format") ?? "json";
        const data = await collect();
        const stamp = berlinDateKey(data.now);
        if (format === "cue" || format === "script") {
          const body = format === "cue" ? liveCue(data) : script(data);
          return new Response(body, {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Content-Disposition": `inline; filename="welle-${format}-${stamp}.txt"`,
              "Cache-Control": "no-store",
            },
          });
        }
        return Response.json(timelineJson(data), {
          headers: {
            "Content-Disposition": `inline; filename="welle-timeline-${stamp}.json"`,
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
