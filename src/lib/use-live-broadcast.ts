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
  /** Livestudio-Modus aktiv? Dann sendet nur die manuelle Warteschlange, der Autopilot pausiert. */
  live: boolean;
  streamUrl: string | null;
  next: NowPlayingNext[];
};

/** Jingles/Slogans/Station-IDs zählen für die Überblendung wie Musik: eine Senderkennung
 *  zwischen zwei Songs soll zügig auf beiden Seiten ineinander überblenden (wie zur Hälfte auf
 *  den 1., zur Hälfte auf den 2. Song gelegt), statt als isoliertes Element mit eigener Ansage-
 *  Behandlung zu wirken. */
function isMusical(kind: string | null | undefined): boolean {
  return kind === "music" || kind === "jingle" || kind === "slogan";
}

/** Wie lange sich zwei Elemente beim Übergang überlappen sollen, bevor das alte ausgeblendet ist.
 *  Echte Gesangserkennung bräuchte Audioanalyse – "introSeconds" ist nur eine grobe, serverseitige
 *  Schätzung. Moderation soll schon ~5s vor Ende des vorigen Elements einsetzen und noch ~5s ins
 *  nächste hineinlaufen (keine Stillephasen) – nur Sprache-zu-Sprache bekommt bewusst eine
 *  kürzere Überblendung (glättet den Schnitt, ohne dass sich zwei Stimmen lange überlappen). */
function crossfadeWindow(
  fromKind: string | null | undefined,
  toKind: string | null | undefined,
  introSeconds: number,
): number {
  const fromMusical = isMusical(fromKind);
  const toMusical = isMusical(toKind);
  if (!fromMusical && toMusical) return Math.max(5, introSeconds || 6); // Ansage spricht übers Intro
  if (fromMusical && !toMusical) return 5; // Musik klingt aus, während die Ansage schon einsetzt
  if (fromMusical && toMusical) return 3; // Songs/Jingles/Slogans zügig ineinander überblenden
  return 1.5; // Ansage zu Ansage: nur den Schnitt glätten, nicht wirklich überlappen lassen
}

/** Lautstärke, auf die die Musik "angeduckt" wird, solange noch eine Ansage darüber läuft. */
const DUCK_VOLUME = 0.18;
/** So lange dauert es, bis die Musik nach Ende der Ansage wieder volle Lautstärke erreicht. */
const SWELL_MS = 5000;
/** Wie lange VOR dem eigentlichen Übergang das nächste Element schon heruntergeladen wird – bewusst
 *  deutlich größer als das Überblend-Fenster: ein Musiktitel kann mehrere MB groß sein, und über
 *  echtes Internet (statt localhost) kann das Laden spürbar länger dauern als die paar Sekunden
 *  Überblendung selbst. Ohne diesen Vorlauf entsteht auf einem echten Server eine hörbare Pause,
 *  auch wenn auf localhost (praktisch verzögerungsfreies Netzwerk) alles nahtlos wirkt. */
const PREFETCH_LEAD_S = 15;

type Slot = { audio: HTMLAudioElement; objectUrl: string | null; uid: string | null };
/** Merkt sich, für welche uid gerade (oder schon) vorab geladen wurde, damit der Übergang nicht
 *  dieselbe Datei zweimal anfordert und damit unabhängig von der eigentlichen Überblendung ist. */
type Prefetch = { uid: string; slotKey: "a" | "b"; ready: boolean };

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
  const prefetchRef = useRef<Prefetch | null>(null);

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
    // Kurzes Intervall: die eigentlichen Übergänge laufen über die Überblendung (Timer im Tab),
    // die der Browser in Hintergrund-Tabs aber drosselt – ein enger Poll-Takt sorgt dafür, dass
    // der Client trotzdem schnell mitbekommt, wenn die Server-Engine schon weitergeschaltet hat,
    // statt erst nach mehreren Sekunden Verzögerung hart nachzuziehen.
    const t = setInterval(load, 2_000);
    // Sobald der Tab wieder sichtbar wird (z. B. nach dem Zurückwechseln), sofort neu abfragen,
    // statt auf das nächste Intervall zu warten – in der Zwischenzeit gedrosselte Timer sonst
    // erst spät bemerken, dass die Sendung längst weiter ist.
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
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
        const rawOffset = Math.max(0, (Date.now() - startedAt) / 1000);
        // Der Livestream muss IMMER an der tatsächlich aktuellen Stelle einsteigen, wie echtes
        // Radio – egal ob gerade Musik oder eine Ansage/Nachricht/Werbung läuft. Kleine
        // Verzögerungen (z. B. durch einen kurz gedrosselten Hintergrund-Tab) werden nicht als
        // Sprung gewertet, deshalb erst ab >2s tatsächlich vorspulen.
        const offset = rawOffset > 2 ? rawOffset : 0;
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

  // Deutlich VOR dem eigentlichen Übergang: das nächste Element schon im Hintergrund laden (siehe
  // PREFETCH_LEAD_S). Getrennt vom eigentlichen Überblenden, damit eine langsame Verbindung (echtes
  // Internet statt localhost) nicht dazu führt, dass der Übergang selbst auf das Laden warten muss.
  useEffect(() => {
    if (!playing || stream) return;
    if (!state?.uid || !state.onAir) return;
    const next = state.next?.[0];
    if (!next) return;
    if (prefetchRef.current?.uid === next.uid) return; // schon geladen oder wird schon geladen

    const activeSlot = getSlot(activeSlotRef.current);
    if (activeSlot.uid !== state.uid) return;

    const remaining = state.duration - elapsedNow;
    if (remaining > PREFETCH_LEAD_S) return;

    const inactiveKey = activeSlotRef.current === "a" ? "b" : "a";
    prefetchRef.current = { uid: next.uid, slotKey: inactiveKey, ready: false };
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`/api/public/onair-audio?uid=${encodeURIComponent(next.uid)}`);
        if (!res.ok || cancelled) {
          if (prefetchRef.current?.uid === next.uid) prefetchRef.current = null;
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        const slot = getSlot(inactiveKey);
        setSlotSrc(slot, next.uid, blob);
        if (prefetchRef.current?.uid === next.uid) prefetchRef.current.ready = true;
      } catch {
        if (prefetchRef.current?.uid === next.uid) prefetchRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, stream, state?.uid, elapsedNow]);

  // Kurz bevor das aktuelle Element endet: beide Plätze überblenden, statt hart auf das nächste
  // Element umzuschalten. Nutzt das oben schon vorab geladene Audio – falls das (bei langsamer
  // Verbindung) noch nicht fertig ist, wartet dieser Effekt einfach auf den nächsten Tick, statt
  // selbst nochmal von vorn zu laden.
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
    // Gilt nur für echte gesprochene Inhalte, nicht für Jingles/Slogans zwischen zwei Songs (die
    // sollen zügig und symmetrisch überblenden, siehe isMusical/crossfadeWindow).
    const isTalkIntoMusic = !isMusical(state.kind) && next.kind === "music";
    const window = isTalkIntoMusic
      ? Math.min(Math.max(5, next.introSeconds || 6), state.duration * 0.9, next.duration * 0.6)
      : Math.min(
          crossfadeWindow(state.kind, next.kind, next.introSeconds),
          state.duration * 0.6,
          next.duration * 0.6,
        );
    const remaining = state.duration - elapsedNow;
    if (remaining > window || remaining <= 0.15) return;

    const prefetch = prefetchRef.current;
    if (!prefetch || prefetch.uid !== next.uid || !prefetch.ready) return; // noch am Laden, nächster Tick

    crossfadeUidRef.current = next.uid;
    const inactiveKey = prefetch.slotKey;
    const incoming = getSlot(inactiveKey);
    const outgoing = activeSlot;
    stopFade();
    // Sicherheitsabstand: falls der Tick etwas spät dran ist, nie mit negativer/verschwindender
    // Restzeit rechnen (würde die Ansage sofort abschneiden statt sie ausklingen zu lassen).
    const safeRemaining = Math.max(0.3, remaining);

    if (isTalkIntoMusic) {
      // Die Ansage bleibt bis zu ihrem eigenen, natürlichen Ende auf voller Lautstärke – wir
      // fassen sie hier gar nicht an. Die Musik startet leise ("angeduckt") darunter und
      // schwillt erst nach Ende der Ansage über SWELL_MS auf volle Lautstärke an.
      incoming.audio.volume = DUCK_VOLUME;
      void incoming.audio.play().catch(() => undefined);
      const swellStart = performance.now() + safeRemaining * 1000;
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
        prefetchRef.current = null;
        fadeRafRef.current = null;
      };
      fadeRafRef.current = requestAnimationFrame(step);
    } else {
      incoming.audio.volume = 0;
      void incoming.audio.play().catch(() => undefined);
      const fadeMs = Math.max(200, safeRemaining * 1000);
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
        prefetchRef.current = null;
        fadeRafRef.current = null;
      };
      fadeRafRef.current = requestAnimationFrame(step);
    }
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
