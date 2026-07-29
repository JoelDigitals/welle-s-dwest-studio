/**
 * Lokale Medien- und Audio-Datenbank (IndexedDB).
 * Speichert hochgeladene Musik, Jingles, Slogans und Werbespots sowie
 * generierte KI-Audios mit 48h-Gültigkeit.
 */

export type MediaKind = "music" | "jingle" | "slogan" | "ad" | "recording";

export type MediaRecord = {
  id: string;
  kind: MediaKind;
  title: string;
  /** Interpret, Sendername oder Werbekunde */
  artist: string;
  category: string;
  duration: number;
  fileName: string;
  mimeType: string;
  createdAt: number;
  /** Werbung: Kampagnenzeitraum + Wiederholungen pro Stunde */
  runFrom?: number;
  runUntil?: number;
  perHour?: number;
  sponsorOf?: "wetter" | "verkehr" | "nachrichten" | null;
  /** Zuordnung von Jingles/Slogans zu einem Programmplatz */
  slot?: "stundenanfang" | "nachrichten" | "verkehr" | "wetter" | "werbung" | "allgemein" | null;
  /** Lokale Datei (Upload) */
  blob?: Blob;
  /** Freie Musik aus dem Netz (Openverse/CC) statt lokaler Datei */
  streamUrl?: string;
  /** Lizenzhinweis für freie Musik */
  license?: string;
  source?: string;
  /** Nur bei "recording" gesetzt (vom Server anhand der Login-Session vergeben, nicht vom Client
   *  frei wählbar): wer die Aufnahme hochgeladen hat – andere Accounts sehen sie nicht. */
  ownerId?: string;
};

export type TtsRecord = {
  hash: string;
  voice: string;
  text: string;
  createdAt: number;
  expiresAt: number;
  blob: Blob;
};

const DB_NAME = "welle-suedwest";
const DB_VERSION = 1;
const MEDIA = "media";
const TTS = "tts";

export const TTS_TTL_MS = 48 * 60 * 60 * 1000;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB ist in dieser Umgebung nicht verfügbar."));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(MEDIA)) {
          db.createObjectStore(MEDIA, { keyPath: "id" }).createIndex("kind", "kind");
        }
        if (!db.objectStoreNames.contains(TTS)) {
          db.createObjectStore(TTS, { keyPath: "hash" }).createIndex("expiresAt", "expiresAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Datenbank konnte nicht geöffnet werden."));
    });
  }
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("Datenbankfehler"));
      }),
  );
}

export function putMedia(record: MediaRecord) {
  return tx<IDBValidKey>(MEDIA, "readwrite", (s) => s.put(record));
}

export function deleteMedia(id: string) {
  return tx<undefined>(MEDIA, "readwrite", (s) => s.delete(id));
}

export async function listMedia(): Promise<MediaRecord[]> {
  const all = await tx<MediaRecord[]>(MEDIA, "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export function getMedia(id: string) {
  return tx<MediaRecord | undefined>(MEDIA, "readonly", (s) => s.get(id));
}

/** SHA-256 über Text + Stimme – Schlüssel für den Audio-Cache. */
export async function ttsHash(text: string, voice: string) {
  const data = new TextEncoder().encode(`${voice}::${text.trim()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getTts(hash: string): Promise<TtsRecord | null> {
  const rec = await tx<TtsRecord | undefined>(TTS, "readonly", (s) => s.get(hash));
  if (!rec) return null;
  if (rec.expiresAt <= Date.now()) {
    await tx<undefined>(TTS, "readwrite", (s) => s.delete(hash)).catch(() => undefined);
    return null;
  }
  return rec;
}

export async function putTts(rec: Omit<TtsRecord, "createdAt" | "expiresAt">) {
  const now = Date.now();
  await tx<IDBValidKey>(TTS, "readwrite", (s) =>
    s.put({ ...rec, createdAt: now, expiresAt: now + TTS_TTL_MS }),
  );
}

export async function listTts(): Promise<TtsRecord[]> {
  const all = await tx<TtsRecord[]>(TTS, "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/** Entfernt abgelaufene Audios (älter als 48 Stunden). */
export async function purgeExpiredTts() {
  const all = await listTts().catch(() => [] as TtsRecord[]);
  const now = Date.now();
  let removed = 0;
  for (const rec of all) {
    if (rec.expiresAt <= now) {
      await tx<undefined>(TTS, "readwrite", (s) => s.delete(rec.hash)).catch(() => undefined);
      removed++;
    }
  }
  return removed;
}

/** Dauer einer Audiodatei im Browser ermitteln. */
export function readAudioDuration(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(Math.round(value) || 0);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => done(0);
    audio.src = url;
  });
}
