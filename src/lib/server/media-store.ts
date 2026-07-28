import { promises as fs } from "node:fs";
import path from "node:path";
import type { MediaRecord } from "@/lib/media-db";

/**
 * Server-seitiger Speicher für die Medienbibliothek (Musik/Jingles/Slogans/Werbespots).
 *
 * Die Studio-Bibliothek liegt normalerweise nur im Browser (IndexedDB) – die autonome
 * Sende-Engine läuft aber auf dem Server und hatte darauf bisher keinen Zugriff (dokumentierte
 * Einschränkung). Dieser Speicher schreibt hochgeladene Dateien zusätzlich auf den Server, damit
 * die Engine eigene Musik/Jingles tatsächlich verwenden kann.
 *
 * WICHTIG: Ohne einen persistenten Datenträger (Render: "Disk" am Web Service) liegt dieser
 * Ordner im normalen, FLÜCHTIGEN Dateisystem des Deploys – er übersteht Neustarts innerhalb
 * desselben Deploys, geht aber bei jedem neuen Deploy (git push) verloren. Für dauerhafte
 * Uploads braucht es einen Render-Datenträger, gemountet auf den Pfad aus MEDIA_DIR.
 */

type StoredMediaMeta = Omit<MediaRecord, "blob">;

const MEDIA_DIR = process.env.MEDIA_DIR || path.join(process.cwd(), ".media-storage");
const MANIFEST_PATH = path.join(MEDIA_DIR, "manifest.json");

async function ensureDir() {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
}

async function readManifest(): Promise<StoredMediaMeta[]> {
  try {
    const raw = await fs.readFile(MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw) as StoredMediaMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeManifest(list: StoredMediaMeta[]) {
  await ensureDir();
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(list), "utf8");
}

/** Alle gespeicherten Medien (Metadaten, ohne Audiodaten) – für die Sende-Engine und die Liste im Studio. */
export async function listStoredMedia(): Promise<StoredMediaMeta[]> {
  return readManifest();
}

/** Lokale Datei speichern (Upload aus dem Studio). */
export async function addStoredFile(meta: StoredMediaMeta, buffer: Buffer): Promise<void> {
  await ensureDir();
  await fs.writeFile(path.join(MEDIA_DIR, meta.id), buffer);
  const list = await readManifest();
  await writeManifest([...list.filter((m) => m.id !== meta.id), meta]);
}

/** Metadaten-only-Eintrag speichern (z. B. freie Musik aus dem Netz, per streamUrl abrufbar). */
export async function addStoredMeta(meta: StoredMediaMeta): Promise<void> {
  const list = await readManifest();
  await writeManifest([...list.filter((m) => m.id !== meta.id), meta]);
}

/** Audiodaten einer lokal hochgeladenen Datei lesen (nicht für streamUrl-Einträge). */
export async function getStoredFileBuffer(id: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(MEDIA_DIR, id));
  } catch {
    return null;
  }
}

export async function removeStoredMedia(id: string): Promise<void> {
  const list = await readManifest();
  await writeManifest(list.filter((m) => m.id !== id));
  await fs.rm(path.join(MEDIA_DIR, id), { force: true });
}
