import { useRef, useState } from "react";
import { Cloud, Search, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MediaKind, MediaRecord } from "@/lib/media-db";
import type { OnlineTrack, UploadMeta } from "@/lib/use-media-library";
import { formatClock } from "@/lib/radio-data";

const KINDS: Array<{ id: MediaKind; label: string }> = [
  { id: "music", label: "Musik" },
  { id: "jingle", label: "Jingle" },
  { id: "slogan", label: "Slogan / Station-ID" },
  { id: "ad", label: "Werbung" },
  { id: "recording", label: "Aufnahme (vorab aufgezeichnet)" },
];

const SLOTS: Array<{ id: NonNullable<MediaRecord["slot"]>; label: string }> = [
  { id: "allgemein", label: "Allgemein" },
  { id: "stundenanfang", label: "Stundenanfang" },
  { id: "nachrichten", label: "Vor den Nachrichten" },
  { id: "verkehr", label: "Vor dem Verkehr" },
  { id: "wetter", label: "Vor dem Wetter" },
  { id: "werbung", label: "Vor der Werbung" },
];

export function LibraryPanel({
  media,
  error,
  upload,
  addOnline,
  remove,
}: {
  media: MediaRecord[];
  error: string | null;
  upload: (files: File[], meta: UploadMeta) => Promise<void>;
  addOnline: (track: OnlineTrack) => Promise<void>;
  remove: (id: string) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<MediaKind>("music");
  const [artist, setArtist] = useState("");
  const [category, setCategory] = useState("");
  const [slot, setSlot] = useState<NonNullable<MediaRecord["slot"]>>("allgemein");
  const [runFrom, setRunFrom] = useState("");
  const [runUntil, setRunUntil] = useState("");
  const [perHour, setPerHour] = useState("2");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("lofi instrumental");
  const [results, setResults] = useState<OnlineTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      await upload(Array.from(files), {
        kind,
        artist,
        category,
        slot: kind === "jingle" || kind === "slogan" ? slot : null,
        runFrom: kind === "ad" && runFrom ? new Date(runFrom).getTime() : undefined,
        runUntil: kind === "ad" && runUntil ? new Date(runUntil).getTime() : undefined,
        perHour: kind === "ad" ? Number(perHour) || 1 : undefined,
      });
      setArtist("");
      setCategory("");
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/freemusic?q=${encodeURIComponent(query)}&limit=20`);
      const data = (await res.json()) as { items: OnlineTrack[]; error?: string };
      setResults(data.items ?? []);
      if (data.error) setSearchError(data.error);
      else if (!data.items?.length) setSearchError("Keine freien Titel zu dieser Suche gefunden.");
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Suche fehlgeschlagen");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel space-y-4 p-5">
        <h3 className="display text-xl">Upload — Musik, Jingles, Slogans & Werbung</h3>
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground">Typ</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as MediaKind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k.id} value={k.id}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Input
          placeholder={kind === "ad" ? "Werbekunde" : "Interpret"}
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
        />
        <Input
          placeholder="Kategorie (Pop, Rock, Station-ID …)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />

        {(kind === "jingle" || kind === "slogan") && (
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">
              Zuordnung im Programm
            </Label>
            <Select value={slot ?? "allgemein"} onValueChange={(v) => setSlot(v as typeof slot)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SLOTS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {kind === "ad" && (
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Kampagne von</Label>
              <Input type="date" value={runFrom} onChange={(e) => setRunFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">bis</Label>
              <Input type="date" value={runUntil} onChange={(e) => setRunUntil(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Spots/Stunde</Label>
              <Input
                type="number"
                min={1}
                max={6}
                value={perHour}
                onChange={(e) => setPerHour(e.target.value)}
              />
            </div>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
        <Button disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className="size-4" /> {busy ? "Lade hoch…" : "Audiodateien wählen"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">
          Dateien bleiben im Browser gespeichert und werden vom Autopiloten automatisch eingeplant.
        </p>

        <div className="space-y-2 border-t border-border pt-4">
          <h4 className="display flex items-center gap-2 text-lg">
            <Cloud className="size-4 text-primary" /> Freie Musik aus dem Netz
          </h4>
          <p className="text-xs text-muted-foreground">
            Suche über Openverse – ausschließlich kostenlose, CC-lizenzierte Titel zur kommerziellen
            Nutzung.
          </p>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void search()}
              placeholder="z. B. pop instrumental, jazz, rock"
            />
            <Button variant="secondary" disabled={searching} onClick={() => void search()}>
              <Search className="size-4" /> {searching ? "Suche…" : "Suchen"}
            </Button>
          </div>
          {searchError && <p className="text-xs text-destructive">{searchError}</p>}
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {results.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{t.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.artist} · {t.license} · {formatClock(t.duration)}
                  </p>
                </div>
                <Button size="sm" onClick={() => void addOnline(t)}>
                  Übernehmen
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel space-y-3 p-5">
        <h3 className="display text-xl">Bibliothek ({media.length})</h3>
        <div className="max-h-[26rem] space-y-1.5 overflow-y-auto pr-1">
          {media.length === 0 && (
            <p className="text-sm text-muted-foreground">Noch keine Dateien hochgeladen.</p>
          )}
          {media.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{m.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {KINDS.find((k) => k.id === m.kind)?.label} · {m.artist || m.category} ·{" "}
                  {formatClock(m.duration)}
                  {m.slot && m.slot !== "allgemein"
                    ? ` · ${SLOTS.find((s) => s.id === m.slot)?.label}`
                    : ""}
                  {m.streamUrl ? " · Online (CC)" : ""}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => void remove(m.id)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
