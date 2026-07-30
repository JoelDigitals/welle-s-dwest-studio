import { promises as fs } from "node:fs";
import path from "node:path";
import type { MediaRecord } from "@/lib/media-db";
import { getDb, ensureSchema } from "./db";

/**
 * Server-seitiger Speicher für die Medienbibliothek (Musik/Jingles/Slogans/Werbespots/Aufnahmen).
 *
 * Die Metadaten (Titel, Interpret, streamUrl, ownerId, ...) liegen dauerhaft in Postgres – lagen
 * vorher nur in einer lokalen JSON-Datei auf dem flüchtigen Render-Dateisystem und gingen bei
 * jedem Redeploy verloren (der Grund für den früheren "Bibliothek ist leer"-Vorfall).
 *
 * Die eigentlichen Audiodateien liegen inzwischen fast immer extern (JDS Cloud, per streamUrl) –
 * der lokale Datei-Ordner hier ist nur noch eine Rückfallebene für ältere Einträge mit direkt
 * hochgeladenem Blob (dataBase64) und bleibt an das flüchtige Dateisystem gebunden.
 */

type StoredMediaMeta = Omit<MediaRecord, "blob">;

const MEDIA_DIR = process.env.MEDIA_DIR || path.join(process.cwd(), ".media-storage");

async function ensureDir() {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
}

function rowToMeta(row: Record<string, unknown>): StoredMediaMeta {
  return {
    id: String(row.id),
    kind: row.kind as MediaRecord["kind"],
    title: String(row.title),
    artist: String(row.artist ?? ""),
    category: String(row.category ?? ""),
    duration: Number(row.duration ?? 0),
    fileName: String(row.file_name ?? ""),
    mimeType: String(row.mime_type ?? ""),
    createdAt: Number(row.created_at),
    runFrom: row.run_from == null ? undefined : Number(row.run_from),
    runUntil: row.run_until == null ? undefined : Number(row.run_until),
    perHour: row.per_hour == null ? undefined : Number(row.per_hour),
    sponsorOf: (row.sponsor_of ?? null) as MediaRecord["sponsorOf"],
    slot: (row.slot ?? null) as MediaRecord["slot"],
    streamUrl: row.stream_url == null ? undefined : String(row.stream_url),
    license: row.license == null ? undefined : String(row.license),
    source: row.source == null ? undefined : String(row.source),
    ownerId: row.owner_id == null ? undefined : String(row.owner_id),
  };
}

/** Alle gespeicherten Medien (Metadaten, ohne Audiodaten) – für die Sende-Engine und die Liste im Studio. */
export async function listStoredMedia(): Promise<StoredMediaMeta[]> {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`SELECT * FROM media_library ORDER BY created_at DESC`;
  return rows.map((r) => rowToMeta(r as unknown as Record<string, unknown>));
}

async function upsertMeta(meta: StoredMediaMeta): Promise<void> {
  await ensureSchema();
  const sql = getDb();
  await sql`
    INSERT INTO media_library (
      id, kind, title, artist, category, duration, file_name, mime_type, created_at,
      run_from, run_until, per_hour, sponsor_of, slot, stream_url, license, source, owner_id
    ) VALUES (
      ${meta.id}, ${meta.kind}, ${meta.title}, ${meta.artist ?? ""}, ${meta.category ?? ""},
      ${meta.duration ?? 0}, ${meta.fileName ?? ""}, ${meta.mimeType ?? ""}, ${meta.createdAt ?? Date.now()},
      ${meta.runFrom ?? null}, ${meta.runUntil ?? null}, ${meta.perHour ?? null},
      ${meta.sponsorOf ?? null}, ${meta.slot ?? null}, ${meta.streamUrl ?? null},
      ${meta.license ?? null}, ${meta.source ?? null}, ${meta.ownerId ?? null}
    )
    ON CONFLICT (id) DO UPDATE SET
      kind = EXCLUDED.kind, title = EXCLUDED.title, artist = EXCLUDED.artist,
      category = EXCLUDED.category, duration = EXCLUDED.duration, file_name = EXCLUDED.file_name,
      mime_type = EXCLUDED.mime_type, run_from = EXCLUDED.run_from, run_until = EXCLUDED.run_until,
      per_hour = EXCLUDED.per_hour, sponsor_of = EXCLUDED.sponsor_of, slot = EXCLUDED.slot,
      stream_url = EXCLUDED.stream_url, license = EXCLUDED.license, source = EXCLUDED.source,
      owner_id = EXCLUDED.owner_id
  `;
}

/** Lokale Datei speichern (Upload aus dem Studio) – nur noch für den seltenen Fall eines
 *  direkten Blob-Uploads statt einer externen streamUrl. */
export async function addStoredFile(meta: StoredMediaMeta, buffer: Buffer): Promise<void> {
  await ensureDir();
  await fs.writeFile(path.join(MEDIA_DIR, meta.id), buffer);
  await upsertMeta(meta);
}

/** Metadaten-only-Eintrag speichern (z. B. freie Musik oder JDS-Cloud-Uploads, per streamUrl abrufbar). */
export async function addStoredMeta(meta: StoredMediaMeta): Promise<void> {
  await upsertMeta(meta);
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
  await ensureSchema();
  const sql = getDb();
  await sql`DELETE FROM media_library WHERE id = ${id}`;
  await fs.rm(path.join(MEDIA_DIR, id), { force: true });
}
