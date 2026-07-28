import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { prepareItem } from "./audio-prep";
import { buildPlan, speakDuration, urgentText } from "./planner";
import { purgeExpiredTts } from "./media-db";
import type { LogEntry, PlanContext, PlanItem } from "./broadcast-types";
import type { MediaRecord } from "./media-db";

export type { ItemKind, PlanItem } from "./broadcast-types";
/** Rückwärtskompatibler Alias – ein Plan-Element in der Sendeliste. */
export type QueueItem = PlanItem;

let counter = 0;
const uid = () => `q${++counter}-${Date.now().toString(36)}`;

/** Wie viele Elemente im Voraus als Audio erzeugt werden. */
const PRERENDER = 10;
/** Wie viele Audios gleichzeitig erzeugt werden. */
const CONCURRENCY = 3;
/** Planungshorizont in Stunden (15 Minuten – so bleibt der Plan immer aktuell). */
export const PLAN_HOURS = 0.25;
/** Ab wie wenigen Restminuten automatisch nachgeplant wird. */
const REFILL_MINUTES = 8;

export function manualItem(
  partial: Partial<PlanItem> & { kind: PlanItem["kind"]; title: string },
): PlanItem {
  const duration = partial.duration ?? (partial.text ? speakDuration(partial.text) : 30);
  return {
    uid: uid(),
    subtitle: partial.subtitle ?? "Manuell",
    duration,
    plannedAt: Date.now(),
    status: "idle",
    ...partial,
  } as PlanItem;
}

export function mediaItem(rec: MediaRecord, kind: PlanItem["kind"] = "music"): PlanItem {
  return manualItem({
    kind,
    title: rec.title,
    subtitle: rec.artist || rec.category,
    duration: rec.duration,
    mediaId: rec.id,
  });
}

export function useRadioEngine(ctx: PlanContext) {
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [autopilot, setAutopilot] = useState(true);
  const [live, setLive] = useState(false);
  /** Bei Abbruch automatisch das nächste freigegebene Element starten. */
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [micOn, setMicOn] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [musicVolume, setMusicVolume] = useState(70);
  const [voiceVolume, setVoiceVolume] = useState(100);
  const [speaking, setSpeaking] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [outputLevel, setOutputLevel] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingUidRef = useRef<string | null>(null);
  const elapsedRef = useRef(0);
  elapsedRef.current = elapsed;
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const compRef = useRef<DynamicsCompressorNode | null>(null);
  const makeupRef = useRef<GainNode | null>(null);
  const limiterRef = useRef<DynamicsCompressorNode | null>(null);
  /** Positionen unterbrochener Elemente, um nahtlos zurückzuspringen. */
  const resumeAtRef = useRef<Map<string, number>>(new Map());
  const ctxRef = useRef<PlanContext>(ctx);
  ctxRef.current = ctx;

  /** Überblendung zwischen zwei Musiktiteln (siehe beginMusicCrossfade weiter unten). */
  const CROSSFADE_SECONDS = 3;
  const crossfadingRef = useRef(false);
  const crossfadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCrossfadeRef = useRef<{ audio: HTMLAudioElement; gain: GainNode } | null>(null);
  /** Immer aktueller Sendeplan zum Lesen in Event-Handlern, ohne den Haupteffekt bei jeder
   *  Planänderung neu laufen zu lassen (der reagiert bewusst nur auf `current`). */
  const planRef = useRef<PlanItem[]>([]);
  planRef.current = plan;

  const addLog = useCallback((level: LogEntry["level"], message: string) => {
    setLog((l) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          at: Date.now(),
          level,
          message,
        },
        ...l,
      ].slice(0, 200),
    );
  }, []);

  const current = plan[0] ?? null;

  // Erstplanung, sobald Feeds/Medien geladen sind
  const regenerate = useCallback(
    (hours = PLAN_HOURS) => {
      const fresh = buildPlan({ from: new Date(), hours, ctx: ctxRef.current });
      setPlan((p) => {
        const head = p[0];
        if (!head) return fresh;
        // Doppelte Zeitmarken (z. B. laufende Nachrichten) nicht erneut einplanen
        const cleaned = head.hardStart
          ? fresh.filter((i) => i.hardStart !== head.hardStart || i.kind !== head.kind)
          : fresh;
        return [head, ...cleaned];
      });
      addLog("info", `Sendeplan für ${hours} Stunden neu erstellt (${fresh.length} Elemente).`);
    },
    [addLog],
  );

  const extendPlan = useCallback(
    (hours = PLAN_HOURS) => {
      const last = plan[plan.length - 1];
      const from = last ? new Date(last.plannedAt + last.duration * 1000) : new Date();
      const more = buildPlan({ from, hours, ctx: ctxRef.current });
      setPlan((p) => [...p, ...more]);
      addLog("info", `Planung um ${Math.round(hours * 60)} Minuten verlängert.`);
    },
    [plan, addLog],
  );

  useEffect(() => {
    if (plan.length === 0) {
      setPlan(buildPlan({ from: new Date(), hours: PLAN_HOURS, ctx: ctxRef.current }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void purgeExpiredTts().then((n) => {
      if (n > 0) addLog("info", `${n} abgelaufene Audios (älter als 48h) entfernt.`);
    });
  }, [addLog]);

  // Zeitraster sauber halten: geplante Startzeiten laufend nachziehen, damit
  // sich das Programm nicht Stück für Stück verschiebt.
  useEffect(() => {
    const id = setInterval(() => {
      setPlan((p) => {
        if (p.length === 0) return p;
        let cursor = Date.now() + (p[0].duration - elapsedRef.current) * 1000;
        let changed = false;
        const next = p.map((item, i) => {
          if (i === 0) return item;
          // Harte Zeitmarken (Nachrichten) bleiben sekundengenau stehen.
          const at = item.hardStart ?? cursor;
          cursor = at + item.duration * 1000;
          if (Math.abs(at - item.plannedAt) < 5000) return item;
          changed = true;
          return { ...item, plannedAt: at };
        });
        return changed ? next : p;
      });
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Audio im Voraus erzeugen – parallel, damit Sprechtexte rechtzeitig fertig sind
  const inflightRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const inflight = inflightRef.current;
    const pending = plan
      .slice(0, PRERENDER)
      .filter((i) => i.status === "idle" && !inflight.has(i.uid));
    const free = Math.max(0, CONCURRENCY - inflight.size);
    if (pending.length === 0 || free === 0) return;

    const run = async (item: PlanItem) => {
      inflight.add(item.uid);
      setPlan((p) => p.map((i) => (i.uid === item.uid ? { ...i, status: "preparing" } : i)));
      try {
        const { audioUrl, fromCache } = await prepareItem(item);
        setPlan((p) =>
          p.map((i) => (i.uid === item.uid ? { ...i, status: "ready", audioUrl, fromCache } : i)),
        );
        if (item.text && !fromCache) addLog("info", `Audio erzeugt: ${item.title}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Audio konnte nicht erzeugt werden";
        setPlan((p) =>
          p.map((i) => (i.uid === item.uid ? { ...i, status: "error", error: message } : i)),
        );
        setTtsError(message);
        addLog("error", `${item.title}: ${message}`);
      } finally {
        inflight.delete(item.uid);
      }
    };

    for (const item of pending.slice(0, free)) void run(item);
  }, [plan, addLog]);

  // Harte Zeitmarken: Nachrichten starten sekundengenau zur vollen/halben Stunde
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      setPlan((p) => {
        const idx = p.findIndex(
          (i) => i.hardStart && i.hardStart <= now && i.hardStart > now - 90_000,
        );
        if (idx <= 0) return p;
        return p.slice(idx);
      });
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Abgelaufene Elemente automatisch aus dem Plan entfernen (das laufende bleibt)
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setPlan((p) =>
        p.filter((i, index) => index === 0 || i.plannedAt + i.duration * 1000 > now - 30_000),
      );
    }, 20_000);
    return () => clearInterval(id);
  }, []);

  /** Alles löschen – Sendung stoppt, Plan ist leer. */
  const clearPlan = useCallback(() => {
    setPlan([]);
    setPlaying(false);
    addLog("warn", "Sendeplan komplett gelöscht.");
  }, [addLog]);

  /** Nur die bereits vergangenen Elemente entfernen. */
  const prunePast = useCallback(() => {
    const now = Date.now();
    setPlan((p) => {
      const next = p.filter((i, index) => index === 0 || i.plannedAt + i.duration * 1000 > now);
      addLog("info", `${p.length - next.length} abgelaufene Elemente entfernt.`);
      return next;
    });
  }, [addLog]);

  // Spontane Unterbrechung: neue Gefahrenmeldung geht sofort nach dem laufenden Element on air
  const urgentSeen = useRef<string>("");
  useEffect(() => {
    if (!autopilot) return;
    const text = urgentText(ctxRef.current);
    if (!text || text === urgentSeen.current) return;
    urgentSeen.current = text;
    const item = manualItem({
      kind: "traffic",
      title: "Wichtige Meldung (Unterbrechung)",
      subtitle: "Spontane Einblendung",
      text,
      duration: speakDuration(text),
    });
    setPlan((p) => {
      const running = p[0];
      const audio = audioRef.current;
      const isMusic = running && (running.kind === "music" || running.kind === "jingle");
      // Läuft Musik, wird sofort weggeblendet (Ducking) und danach
      // nahtlos an genau dieser Stelle weitergespielt.
      if (running && isMusic && audio && !audio.paused) {
        const position = audio.currentTime;
        const gain = gainRef.current;
        if (gain) {
          const t = gain.context.currentTime;
          gain.gain.cancelScheduledValues(t);
          gain.gain.setTargetAtTime(0.12, t, 0.15);
        }
        const resumed = { ...running, uid: `${running.uid}-resume` };
        resumeAtRef.current.set(resumed.uid, position);
        playingUidRef.current = null;
        window.setTimeout(() => setElapsed(0), 0);
        addLog("warn", "Wichtige Meldung: Musik wird ausgeblendet, danach geht es nahtlos weiter.");
        return [item, resumed, ...p.slice(1)];
      }
      addLog("warn", "Autopilot unterbricht für eine wichtige Meldung.");
      return p.length ? [p[0], item, ...p.slice(1)] : [item];
    });
  }, [ctx.traffic, ctx.hotline, autopilot, addLog]);

  // Sobald Titel aus der Bibliothek oder dem kostenlosen Musikpool verfügbar sind, neu planen
  // (der Free-Music-Pool lädt asynchron nach und ist beim ersten Planungsdurchlauf oft noch leer).
  const libraryMusicSize = ctx.media.filter((m) => m.kind === "music").length;
  const freeMusicSize = ctx.freeMusic?.length ?? 0;
  const musicPoolSize = libraryMusicSize + freeMusicSize;
  const poolRef = useRef(0);
  useEffect(() => {
    if (musicPoolSize > 0 && poolRef.current === 0) {
      poolRef.current = musicPoolSize;
      regenerate();
      addLog(
        "info",
        `${libraryMusicSize} Titel aus der Bibliothek und ${freeMusicSize} freie Titel geladen – Sendeplan aktualisiert.`,
      );
    }
  }, [musicPoolSize, libraryMusicSize, freeMusicSize, regenerate, addLog]);

  // Werbefreigaben / Livesendungen / Freigabepflicht geändert → Plan neu aufbauen
  const settingsKey = `${(ctx.adCampaigns ?? [])
    .filter((c) => c.status === "freigegeben")
    .map((c) => c.id)
    .join(
      ",",
    )}|${(ctx.liveSlots ?? []).map((s) => `${s.id}:${s.startAt}:${s.minutes}`).join(",")}|${
    ctx.approvalRequired ? 1 : 0
  }`;
  const settingsRef = useRef(settingsKey);
  useEffect(() => {
    if (settingsRef.current === settingsKey) return;
    settingsRef.current = settingsKey;
    regenerate();
  }, [settingsKey, regenerate]);

  /** Bricht eine laufende Überblendung sauber ab (z. B. bei manuellem Stopp/Skip). */
  const cancelCrossfade = useCallback(() => {
    if (crossfadeTimeoutRef.current) {
      clearTimeout(crossfadeTimeoutRef.current);
      crossfadeTimeoutRef.current = null;
    }
    const pending = pendingCrossfadeRef.current;
    if (pending) {
      pending.audio.pause();
      pending.audio.removeAttribute("src");
      pending.audio.load();
      pendingCrossfadeRef.current = null;
    }
    crossfadingRef.current = false;
  }, []);

  const stopAudio = useCallback(() => {
    cancelCrossfade();
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    playingUidRef.current = null;
    setSpeaking(false);
  }, [cancelCrossfade]);

  const next = useCallback(() => {
    if (failureBackoffRef.current) {
      clearTimeout(failureBackoffRef.current);
      failureBackoffRef.current = null;
    }
    stopAudio();
    setElapsed(0);
    setPlan((p) => p.slice(1));
  }, [stopAudio]);

  /**
   * Bremse gegen Fehler-Kaskaden: ein kaputter Titel darf nicht in derselben
   * Millisekunde Dutzende Folgetitel anstoßen (das überlastet Netzwerk/Server
   * und wirkt so, als würde gar keine Musik mehr laufen). Nach ein paar
   * Fehlern hintereinander hält die Wiedergabe stattdessen mit einer klaren
   * Meldung an, statt lautlos den ganzen Sendeplan durchzurattern.
   */
  const consecutiveFailuresRef = useRef(0);
  const failureBackoffRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_CONSECUTIVE_FAILURES = 5;
  const skipAfterFailure = useCallback(
    (reason: string) => {
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        addLog(
          "error",
          `${consecutiveFailuresRef.current} Elemente nacheinander fehlgeschlagen – Wiedergabe angehalten. Bitte Internetverbindung prüfen und Sendung erneut starten.`,
        );
        consecutiveFailuresRef.current = 0;
        setPlaying(false);
        return;
      }
      addLog("warn", reason);
      if (failureBackoffRef.current) clearTimeout(failureBackoffRef.current);
      failureBackoffRef.current = setTimeout(() => next(), 500);
    },
    [addLog, next],
  );

  /**
   * Weiche Überblendung zwischen zwei Musiktiteln: der nächste Song startet schon
   * während der letzten Sekunden des laufenden Titels (gleichzeitig statt hart
   * geschnitten). Läuft über einen eigenen, kurzlebigen Audio-Knoten, der am Ende
   * zum neuen Haupt-Audio befördert wird – Ducking, Nachrichten-Zeitmarken und
   * die Lautstärke-Angleichung greifen danach unverändert weiter.
   */
  const beginMusicCrossfade = useCallback(
    (nextItem: PlanItem) => {
      const outgoingAudio = audioRef.current;
      const outgoingGain = gainRef.current;
      const comp = compRef.current;
      if (!outgoingAudio || !outgoingGain || !comp || !nextItem.audioUrl) return;
      crossfadingRef.current = true;

      const actx = outgoingGain.context as AudioContext;
      const incomingAudio = new Audio();
      incomingAudio.crossOrigin = "anonymous";
      incomingAudio.preload = "auto";
      incomingAudio.src = nextItem.audioUrl;
      incomingAudio.volume = musicVolume / 100;
      incomingAudio.load();

      let incomingGain: GainNode;
      try {
        incomingGain = actx.createGain();
        incomingGain.gain.value = 0;
        const source = actx.createMediaElementSource(incomingAudio);
        source.connect(incomingGain);
        incomingGain.connect(comp);
      } catch {
        crossfadingRef.current = false;
        return;
      }
      pendingCrossfadeRef.current = { audio: incomingAudio, gain: incomingGain };
      void incomingAudio.play().catch(() => undefined);

      const t = actx.currentTime;
      outgoingGain.gain.cancelScheduledValues(t);
      outgoingGain.gain.setTargetAtTime(0, t, CROSSFADE_SECONDS / 3);
      incomingGain.gain.cancelScheduledValues(t);
      incomingGain.gain.setTargetAtTime(1, t, CROSSFADE_SECONDS / 3);

      addLog(
        "info",
        `Überblendung: „${nextItem.title}" setzt ein, während der vorige Titel ausklingt.`,
      );

      crossfadeTimeoutRef.current = setTimeout(() => {
        outgoingAudio.pause();
        outgoingAudio.removeAttribute("src");
        outgoingAudio.load();
        audioRef.current = incomingAudio;
        gainRef.current = incomingGain;
        playingUidRef.current = nextItem.uid;
        pendingCrossfadeRef.current = null;
        crossfadeTimeoutRef.current = null;
        crossfadingRef.current = false;
        setElapsed(Math.floor(incomingAudio.currentTime));
        setPlan((p) => p.slice(1));
      }, CROSSFADE_SECONDS * 1000);
    },
    [musicVolume, addLog],
  );

  // Wiedergabe des aktuellen Elements (nur wenn Audio fertig ist)
  useEffect(() => {
    if (!playing || !current) return;
    if (current.status === "error") {
      if (!fallbackEnabled) {
        addLog("error", `Ausspielung gestoppt: ${current.title} (Fallback aus).`);
        setPlaying(false);
        return;
      }
      skipAfterFailure(`Fallback: ${current.title} übersprungen, nächstes Element startet.`);
      return;
    }
    if (current.needsApproval && !current.approved) {
      addLog("warn", `Warte auf Freigabe: ${current.title}`);
      return;
    }
    if (current.status !== "ready" || !current.audioUrl) return;

    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    // CORS erlauben, sonst liefert die Web-Audio-Analyse bei externen Streams nur Stille.
    audio.crossOrigin = "anonymous";
    audio.preload = "auto";
    if (playingUidRef.current !== current.uid) {
      playingUidRef.current = current.uid;
      audio.src = current.audioUrl;
      audio.load();
      // Nach einer Unterbrechung genau an der alten Stelle weiterlaufen.
      const resumeAt = resumeAtRef.current.get(current.uid);
      if (resumeAt) {
        resumeAtRef.current.delete(current.uid);
        const seek = () => {
          try {
            audio.currentTime = resumeAt;
          } catch {
            /* Position nicht setzbar – dann von vorne */
          }
          audio.removeEventListener("loadedmetadata", seek);
        };
        audio.addEventListener("loadedmetadata", seek);
        addLog("info", "Zurück im Programm – Musik läuft nahtlos weiter.");
      }
      // Nach dem Ducking wieder sauber aufblenden.
      const gainNode = gainRef.current;
      if (gainNode) {
        const t = gainNode.context.currentTime;
        gainNode.gain.cancelScheduledValues(t);
        gainNode.gain.setTargetAtTime(
          current.kind === "music" || current.kind === "jingle" ? 1 : 3,
          t,
          0.12,
        );
      }
      audio.volume =
        (current.kind === "music" || current.kind === "jingle" ? musicVolume : voiceVolume) / 100;
      setSpeaking(Boolean(current.text));
      audio
        .play()
        .catch((err) =>
          addLog(
            "warn",
            `Wiedergabe blockiert (${err instanceof Error ? err.name : "Fehler"}) – bitte Sendung erneut starten.`,
          ),
        );
      consecutiveFailuresRef.current = 0;
      addLog("info", `ON AIR: ${current.title}`);
    }
    const onEnded = () => {
      // War schon eine Überblendung im Gang, übernimmt deren eigener Timer den Wechsel.
      if (crossfadingRef.current) return;
      next();
    };
    const onTime = () => {
      setElapsed(Math.floor(audio.currentTime));
      if (crossfadingRef.current) return;
      if (current.kind !== "music") return;
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const remaining = audio.duration - audio.currentTime;
      if (remaining > CROSSFADE_SECONDS || remaining <= 0) return;
      const upcoming = planRef.current[1];
      if (
        upcoming &&
        upcoming.kind === "music" &&
        upcoming.status === "ready" &&
        upcoming.audioUrl &&
        !upcoming.hardStart
      ) {
        beginMusicCrossfade(upcoming);
      }
    };
    const onError = () => {
      if (!fallbackEnabled) {
        addLog("error", `Audio-Fehler bei „${current.title}" – Fallback ist ausgeschaltet.`);
        setPlaying(false);
        return;
      }
      skipAfterFailure(
        `Audio-Fehler bei „${current.title}" – Fallback startet das nächste Element.`,
      );
    };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("error", onError);
    };
  }, [
    playing,
    current,
    next,
    skipAfterFailure,
    beginMusicCrossfade,
    addLog,
    musicVolume,
    voiceVolume,
    fallbackEnabled,
  ]);

  useEffect(() => {
    if (!playing) audioRef.current?.pause();
    else if (audioRef.current?.src) void audioRef.current.play().catch(() => undefined);
  }, [playing]);

  useEffect(() => {
    const a = audioRef.current;
    if (a && current) {
      a.volume =
        (current.kind === "music" || current.kind === "jingle" ? musicVolume : voiceVolume) / 100;
    }
  }, [musicVolume, voiceVolume, current]);

  // Pegelmessung der Sendeausgabe
  useEffect(() => {
    if (!playing) return;
    const audio = audioRef.current;
    if (!audio || typeof AudioContext === "undefined") return;
    let raf = 0;
    if (!analyserRef.current) {
      try {
        const actx = new AudioContext();
        const source = actx.createMediaElementSource(audio);
        const analyser = actx.createAnalyser();
        analyser.fftSize = 512;
        const gain = actx.createGain();
        // Kompressor gleicht die unterschiedlich lauten Sprecherstimmen an
        // (Loudness-Angleichung wie im echten Sendebetrieb).
        const comp = actx.createDynamicsCompressor();
        comp.threshold.value = -24;
        comp.knee.value = 24;
        comp.ratio.value = 6;
        comp.attack.value = 0.005;
        comp.release.value = 0.25;
        // Aufholverstärkung + Limiter: laute Ansagen mit sauberem Headroom,
        // ohne dass die Summe übersteuert.
        const makeup = actx.createGain();
        makeup.gain.value = 1.6;
        const limiter = actx.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.12;
        source.connect(gain);
        gain.connect(comp);
        comp.connect(makeup);
        makeup.connect(limiter);
        limiter.connect(analyser);
        analyser.connect(actx.destination);
        gainRef.current = gain;
        compRef.current = comp;
        makeupRef.current = makeup;
        limiterRef.current = limiter;
        analyserRef.current = analyser;
      } catch {
        return;
      }
    }
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      setOutputLevel(peak);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Sprechtexte lauter aussteuern als Musik und stärker komprimieren,
  // damit alle Moderationsstimmen gleich laut klingen.
  useEffect(() => {
    const gain = gainRef.current;
    const comp = compRef.current;
    if (!gain || !current) return;
    const isMusic = current.kind === "music" || current.kind === "jingle";
    const target = isMusic ? 1 : 3;
    // Sanfte Rampe statt Sprung – verhindert Knackser beim Wechsel.
    const ctxTime = gain.context.currentTime;
    gain.gain.cancelScheduledValues(ctxTime);
    gain.gain.setTargetAtTime(target, ctxTime, 0.05);
    if (comp) {
      // Sprache stark normalisiert, damit alle Stimmen gleich laut sind.
      comp.threshold.value = isMusic ? -18 : -32;
      comp.ratio.value = isMusic ? 3 : 12;
      comp.knee.value = isMusic ? 20 : 8;
    }
    if (makeupRef.current) makeupRef.current.gain.value = isMusic ? 1.2 : 1.8;
  }, [current]);

  // Mikrofon-Pegel
  useEffect(() => {
    if (!micOn) {
      setMicLevel(0);
      return;
    }
    let raf = 0;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let stopped = false;

    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const loop = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
          setMicLevel(peak);
          raf = requestAnimationFrame(loop);
        };
        loop();
      })
      .catch(() => setMicOn(false));

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, [micOn]);

  const enqueue = useCallback((item: QueueItem) => setPlan((q) => [...q, item]), []);
  const cueNext = useCallback(
    (item: QueueItem) => setPlan((q) => [q[0], item, ...q.slice(1)].filter(Boolean) as QueueItem[]),
    [],
  );
  const playNow = useCallback(
    (item: QueueItem) => {
      stopAudio();
      setElapsed(0);
      setPlan((q) => [item, ...q]);
      setPlaying(true);
    },
    [stopAudio],
  );
  const remove = useCallback((id: string) => setPlan((q) => q.filter((i) => i.uid !== id)), []);
  /** Element per Drag & Drop an eine andere Stelle im Plan schieben. */
  const reorder = useCallback((fromUid: string, toUid: string) => {
    setPlan((q) => {
      const from = q.findIndex((i) => i.uid === fromUid);
      const to = q.findIndex((i) => i.uid === toUid);
      if (from < 0 || to < 0 || from === to) return q;
      const next = [...q];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);
  const approve = useCallback(
    (id: string) => setPlan((q) => q.map((i) => (i.uid === id ? { ...i, approved: true } : i))),
    [],
  );
  const approveAll = useCallback(
    () =>
      setPlan((q) => q.map((i) => (i.needsApproval && !i.approved ? { ...i, approved: true } : i))),
    [],
  );

  const totalPlanned = useMemo(() => plan.reduce((sum, i) => sum + i.duration, 0), [plan]);

  // Automatisch nachplanen, sobald weniger als REFILL_MINUTES Programm übrig sind.
  useEffect(() => {
    if (!autopilot) return;
    if (totalPlanned > REFILL_MINUTES * 60) return;
    const last = plan[plan.length - 1];
    const from = last ? new Date(last.plannedAt + last.duration * 1000) : new Date();
    const more = buildPlan({ from, hours: PLAN_HOURS, ctx: ctxRef.current });
    if (more.length) setPlan((p) => [...p, ...more]);
  }, [totalPlanned, autopilot, plan]);

  const readyCount = useMemo(() => plan.filter((i) => i.status === "ready").length, [plan]);

  // Hinweis: /api/public/nowplaying wird seit der autonomen Server-Sende-Engine
  // (src/lib/server/station-engine.ts) nicht mehr von hier aus gemeldet – dieser lokale
  // Studio-Autopilot ist nur noch Vorschau/manuelle Steuerung, das echte "on air" läuft
  // dauerhaft auf dem Server weiter, auch ohne offenes Studio-Fenster.

  return {
    plan,
    queue: plan,
    current,
    elapsed,
    playing,
    setPlaying,
    autopilot,
    setAutopilot,
    live,
    setLive,
    fallbackEnabled,
    setFallbackEnabled,
    micOn,
    setMicOn,
    micLevel,
    musicVolume,
    setMusicVolume,
    voiceVolume,
    setVoiceVolume,
    speaking,
    ttsError,
    outputLevel,
    log,
    addLog,
    readyCount,
    next,
    enqueue,
    cueNext,
    playNow,
    remove,
    reorder,
    approve,
    approveAll,
    regenerate,
    extendPlan,
    clearPlan,
    prunePast,
    totalPlanned,
  };
}
