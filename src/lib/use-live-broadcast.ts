import { useEffect, useRef, useState } from "react";

export type NowPlayingNext = {
  uid: string;
  kind: string;
  title: string;
  subtitle: string;
  duration: number;
  introSeconds: number;
  plannedAt: number;
};

export type NowPlaying = {
  station: string;
  show: string | null;
  host: string | null;
  kind: string | null;
  title: string | null;
  subtitle: string | null;
  uid: string | null;
  startedAt: number | null;
  duration: number;
  introSeconds: number;
  elapsed: number;
  onAir: boolean;
  streamUrl: string | null;
  next: NowPlayingNext[];
};

/** Wie lange sich zwei Elemente beim Übergang überlappen sollen, bevor das alte ausgeblendet ist.
 *  Echte Gesangserkennung bräuchte Audioanalyse – "introSeconds" ist nur eine grobe, serverseitige
 *  Schätzung. Sprache-zu-Sprache bekommt bewusst nur eine winzige Überblendung (glättet den
 *  Schnitt, ohne dass sich zwei Ansagen hörbar überlappen). */
function crossfadeWindow(
  fromKind: string | null | undefined,
  toKind: string | null | undefined,
  introSeconds: number,
): number {
  const fromMusic = fromKind === "music";
  const toMusic = toKind === "music";
  if (!fromMusic && toMusic) return Math.max(3, introSeconds || 6); // Ansage spricht übers Intro
  if (fromMusic && !toMusic) return 2.5; // Musik klingt kurz aus, während die Ansage einsetzt
  if (fromMusic && toMusic) return 3; // klassische DJ-Überblendung
  return 1.2; // Ansage zu Ansage: nur den Schnitt glätten, nicht wirklich überlappen lassen
}

/** Lautstärke, auf die die Musik "angeduckt" wird, solange noch eine Ansage darüber läuft. */
const DUCK_VOLUME = 0.18;
/** So lange dauert es, bis die Musik nach Ende der Ansage wieder volle Lautstärke erreicht. */
const SWELL_MS = 5000;

type Slot = { audio: HTMLAudioElement; objectUrl: string | null; uid: string | null };

/**
 * Verbindung zum echten Sender (Server-Engine, läuft dauerhaft unabhängig von jedem Tab):
 * liest /api/public/nowplaying und spielt bei Bedarf live mit – entweder über eine im Studio
 * hinterlegte Icecast-Stream-URL, oder wenn keine gesetzt ist, direkt über das gerade laufende
 * Sendeplan-Element ("live einsteigen", an der richtigen Stelle). Übergänge zwischen zwei
 * Elementen werden weich überblendet statt hart geschnitten (siehe crossfadeWindow oben).
 *
 * Wird sowohl vom öffentlichen Webplayer als auch vom Studio (OnAirBar) genutzt, damit beide zu
 * jedem Zeitpunkt exakt dasselbe zeigen und abspielen – keine zwei unterschiedlichen Sendungen.
 */
export function useLiveBroadcast() {
  const [state, setState] = useState<NowPlaying | null>(null);
  const [playing, setPlaying] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [elapsedNow, setElapsedNow] = useState(0);

  // Zwei Audio-Plätze ("a"/"b"), die sich abwechseln: während einer noch ausklingt, spielt der
  // andere schon das nächste Element an – beide gleichzeitig hörbar ergibt die Überblendung.
  const slotsRef = useRef<{ a: Slot | null; b: Slot | null }>({ a: null, b: null });
  const activeSlotRef = useRef<"a" | "b">("a");
  const crossfadeUidRef = useRef<string | null>(null);
  const fadeRafRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/public/nowplaying");
        const data = (await res.json()) as NowPlaying;
        if (active) setState(data);
      } catch {
        /* nächster Versuch beim folgenden Intervall */
      }
    };
    void load();
    const t = setInterval(load, 5_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  // Fortschrittsanzeige zwischen den Now-Playing-Abrufen glatt weiterlaufen lassen.
  useEffect(() => {
    if (!state?.onAir || !state.startedAt) {
      setElapsedNow(state?.elapsed ?? 0);
      return;
    }
    const startedAt = state.startedAt;
    const duration = state.duration;
    const id = setInterval(() => {
      setElapsedNow(Math.min(duration, (Date.now() - startedAt) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [state?.uid, state?.onAir, state?.startedAt, state?.duration, state?.elapsed]);

  const stream = state?.streamUrl ?? null;

  const getSlot = (key: "a" | "b"): Slot => {
    let slot = slotsRef.current[key];
    if (!slot) {
      slot = { audio: new Audio(), objectUrl: null, uid: null };
      slotsRef.current[key] = slot;
    }
    return slot;
  };

  const stopFade = () => {
    if (fadeRafRef.current !== null) {
      cancelAnimationFrame(fadeRafRef.current);
      fadeRafRef.current = null;
    }
  };

  const setSlotSrc = (slot: Slot, uid: string, blob: Blob) => {
    if (slot.objectUrl) URL.revokeObjectURL(slot.objectUrl);
    const url = URL.createObjectURL(blob);
    slot.objectUrl = url;
    slot.uid = uid;
    slot.audio.src = url;
    slot.audio.volume = 0;
  };

  // "Live einsteigen": ohne hinterlegte Icecast-Stream-URL wird direkt das Sendeplan-Element
  // abgespielt, das die Server-Engine gerade on air hat.
  useEffect(() => {
    if (!playing || stream) return;
    if (!state?.uid || !state.onAir) return;

    const activeSlot = getSlot(activeSlotRef.current);
    // Der aktive Platz zeigt bereits (per Überblendung oder frischem Join) auf dieses Element.
    if (activeSlot.uid === state.uid) return;
    // Eine gerade laufende Überblendung übernimmt selbst den Wechsel, sobald sie fertig ist.
    if (crossfadeUidRef.current === state.uid) return;

    let cancelled = false;
    const join = async (uid: string, retried = false) => {
      try {
        const res = await fetch(`/api/public/onair-audio?uid=${encodeURIComponent(uid)}`);
        if (res.status === 409 && !retried) {
          const fresh = (await (await fetch("/api/public/nowplaying")).json()) as NowPlaying;
          if (!cancelled && fresh.uid) {
            setState(fresh);
            await join(fresh.uid, true);
          }
          return;
        }
        if (!res.ok) {
          if (!cancelled)
            setJoinError("Sendung gerade nicht abspielbar – versuche es gleich erneut.");
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        setJoinError(null);

        const slot = getSlot(activeSlotRef.current);
        setSlotSrc(slot, uid, blob);
        slot.audio.volume = 1;
        const startedAt = state?.startedAt ?? Date.now();
        const offset = Math.max(0, (Date.now() - startedAt) / 1000);
        const seek = () => {
          try {
            slot.audio.currentTime = offset;
          } catch {
            /* egal, dann von vorn */
          }
          slot.audio.removeEventListener("loadedmetadata", seek);
        };
        slot.audio.addEventListener("loadedmetadata", seek);
        await slot.audio.play().catch(() => undefined);
      } catch {
        if (!cancelled) setJoinError("Verbindung zur Sendung unterbrochen – wird erneut versucht.");
      }
    };
    void join(state.uid);

    return () => {
      cancelled = true;
    };
  }, [playing, stream, state?.uid, state?.onAir, state?.startedAt]);

  // Kurz bevor das aktuelle Element endet: das nächste schon vorab laden und beide Plätze
  // überblenden, statt hart auf das nächste Element umzuschalten.
  useEffect(() => {
    if (!playing || stream) return;
    if (!state?.uid || !state.onAir) return;
    const next = state.next?.[0];
    if (!next) return;
    if (crossfadeUidRef.current === next.uid) return;

    const activeSlot = getSlot(activeSlotRef.current);
    if (activeSlot.uid !== state.uid) return; // aktuelles Element läuft noch gar nicht selbst

    // Ansage → Musik ist ein Sonderfall (siehe unten): die Stimme bleibt laut, die Musik startet
    // leise darunter und schwillt erst nach dem Ende der Ansage an – kein symmetrisches Überblenden.
    const isTalkIntoMusic = state.kind !== "music" && next.kind === "music";
    const window = isTalkIntoMusic
      ? Math.min(Math.max(3, next.introSeconds || 6), state.duration * 0.9, next.duration * 0.6)
      : Math.min(
          crossfadeWindow(state.kind, next.kind, next.introSeconds),
          state.duration * 0.6,
          next.duration * 0.6,
        );
    const remaining = state.duration - elapsedNow;
    if (remaining > window || remaining <= 0.15) return;

    crossfadeUidRef.current = next.uid;
    const inactiveKey = activeSlotRef.current === "a" ? "b" : "a";
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`/api/public/onair-audio?uid=${encodeURIComponent(next.uid)}`);
        if (!res.ok || cancelled) {
          crossfadeUidRef.current = null;
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;

        const incoming = getSlot(inactiveKey);
        setSlotSrc(incoming, next.uid, blob);
        const outgoing = activeSlot;
        stopFade();

        if (isTalkIntoMusic) {
          // Die Ansage bleibt bis zu ihrem eigenen, natürlichen Ende auf voller Lautstärke – wir
          // fassen sie hier gar nicht an. Die Musik startet leise ("angeduckt") darunter und
          // schwillt erst nach Ende der Ansage über SWELL_MS auf volle Lautstärke an.
          incoming.audio.volume = DUCK_VOLUME;
          await incoming.audio.play().catch(() => undefined);
          const swellStart = performance.now() + Math.max(0, remaining * 1000);
          const step = (now: number) => {
            if (now < swellStart) {
              fadeRafRef.current = requestAnimationFrame(step);
              return;
            }
            const t = Math.min(1, (now - swellStart) / SWELL_MS);
            incoming.audio.volume = DUCK_VOLUME + (1 - DUCK_VOLUME) * t;
            if (t < 1) {
              fadeRafRef.current = requestAnimationFrame(step);
              return;
            }
            outgoing.audio.pause();
            activeSlotRef.current = inactiveKey;
            crossfadeUidRef.current = null;
            fadeRafRef.current = null;
          };
          fadeRafRef.current = requestAnimationFrame(step);
        } else {
          incoming.audio.volume = 0;
          await incoming.audio.play().catch(() => undefined);
          const fadeMs = Math.max(200, remaining * 1000);
          const start = performance.now();
          const step = (now: number) => {
            const t = Math.min(1, (now - start) / fadeMs);
            outgoing.audio.volume = 1 - t;
            incoming.audio.volume = t;
            if (t < 1) {
              fadeRafRef.current = requestAnimationFrame(step);
              return;
            }
            outgoing.audio.pause();
            activeSlotRef.current = inactiveKey;
            crossfadeUidRef.current = null;
            fadeRafRef.current = null;
          };
          fadeRafRef.current = requestAnimationFrame(step);
        }
      } catch {
        crossfadeUidRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, stream, state?.uid, elapsedNow]);

  useEffect(() => {
    if (playing || stream) return;
    stopFade();
    slotsRef.current.a?.audio.pause();
    slotsRef.current.b?.audio.pause();
  }, [playing, stream]);

  useEffect(() => {
    return () => {
      stopFade();
      for (const slot of [slotsRef.current.a, slotsRef.current.b]) {
        if (!slot) continue;
        slot.audio.pause();
        if (slot.objectUrl) URL.revokeObjectURL(slot.objectUrl);
      }
    };
  }, []);

  /** Studio-Steuerung: die echte Sende-Engine sofort zum nächsten Element weiterschalten. */
  const skip = async () => {
    await fetch("/api/engine-skip", { method: "POST" }).catch(() => undefined);
  };

  return { nowPlaying: state, playing, setPlaying, joinError, elapsed: elapsedNow, stream, skip };
}
