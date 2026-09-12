import { useRef, useState } from "react";
import { Cloud, Pencil, Search, Trash2, Upload, X } from "lucide-react";
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

/** Jingles/Slogans dürfen wie Werbung einen Zeitraum bekommen (z. B. nur zur Adventszeit oder für
 *  ein bestimmtes Event) - ohne Zeitraum läuft ein Element wie bisher unbegrenzt. */
const SCHEDULABLE_KINDS: MediaKind[] = ["ad", "jingle", "slogan"];
/** Zusätzlich dürfen Jingles/Slogans ein WIEDERKEHRENDES Wochentags-/Uhrzeit-Fenster bekommen
 *  (z. B. nur werktags 6-9 Uhr) - unabhängig vom Datumsbereich oben, jede Woche neu. */
const RECURRING_SCHEDULABLE_KINDS: MediaKind[] = ["jingle", "slogan"];

const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mo" },
  { value: 2, label: "Di" },
  { value: 3, label: "Mi" },
  { value: 4, label: "Do" },
  { value: 5, label: "Fr" },
  { value: 6, label: "Sa" },
  { value: 0, label: "So" },
];

/** Wochentags-Umschalter: leere Auswahl bedeutet "alle Tage", genau wie ein leeres scheduleDays
 *  serverseitig (mediaIsActive in planner.ts) als "keine Einschränkung" behandelt wird. */
function WeekdayToggle({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {WEEKDAYS.map((d) => {
        const active = value.includes(d.value);
        return (
          <button
            key={d.value}
            type="button"
            onClick={() =>
              onChange(active ? value.filter((v) => v !== d.value) : [...value, d.value].sort())
            }
            className={`rounded-md border px-2 py-1 text-xs font-medium ${
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-secondary/40 text-muted-foreground"
            }`}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

const WEEKDAY_LABEL: Record<number, string> = Object.fromEntries(
  WEEKDAYS.map((d) => [d.value, d.label]),
);
/** Kurzbeschreibung für die Listenansicht, z. B. "Mo–Fr" bei einer zusammenhängenden Auswahl,
 *  sonst einzeln aufgezählt ("Mo, Mi, Fr"). */
function weekdaysSummary(days: number[]): string {
  if (!days.length) return "";
  const sorted = [...days].sort((a, b) => a - b);
  return sorted.map((d) => WEEKDAY_LABEL[d]).join(", ");
}

export function LibraryPanel({
  media,
  error,
  upload,
  addOnline,
  remove,
  update,
}: {
  media: MediaRecord[];
  error: string | null;
  upload: (files: File[], meta: UploadMeta) => Promise<void>;
  addOnline: (track: OnlineTrack) => Promise<void>;
  remove: (id: string) => Promise<void>;
  update: (id: string, patch: Partial<Omit<MediaRecord, "id" | "kind" | "blob">>) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<MediaKind>("music");
  const [artist, setArtist] = useState("");
  const [category, setCategory] = useState("");
  const [slot, setSlot] = useState<NonNullable<MediaRecord["slot"]>>("allgemein");
  const [runFrom, setRunFrom] = useState("");
  const [runUntil, setRunUntil] = useState("");
  const [perHour, setPerHour] = useState("2");
  const [scheduleDays, setScheduleDays] = useState<number[]>([]);
  const [scheduleTimeFrom, setScheduleTimeFrom] = useState("");
  const [scheduleTimeUntil, setScheduleTimeUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("lofi instrumental");
  const [results, setResults] = useState<OnlineTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const schedulable = SCHEDULABLE_KINDS.includes(kind);
      const recurring = RECURRING_SCHEDULABLE_KINDS.includes(kind);
      await upload(Array.from(files), {
        kind,
        artist,
        category,
        slot: kind === "jingle" || kind === "slogan" ? slot : null,
        runFrom: schedulable && runFrom ? new Date(runFrom).getTime() : undefined,
        runUntil: schedulable && runUntil ? new Date(runUntil).getTime() : undefined,
        perHour: kind === "ad" ? Number(perHour) || 1 : undefined,
        scheduleDays: recurring && scheduleDays.length ? scheduleDays : undefined,
        scheduleTimeFrom: recurring && scheduleTimeFrom ? scheduleTimeFrom : undefined,
        scheduleTimeUntil: recurring && scheduleTimeUntil ? scheduleTimeUntil : undefined,
      });
      setArtist("");
      setCategory("");
      setScheduleDays([]);
      setScheduleTimeFrom("");
      setScheduleTimeUntil("");
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

        {SCHEDULABLE_KINDS.includes(kind) && (
          <div className={`grid gap-2 ${kind === "ad" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                {kind === "ad" ? "Kampagne von" : "Läuft ab (optional)"}
              </Label>
              <Input type="date" value={runFrom} onChange={(e) => setRunFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">bis</Label>
              <Input type="date" value={runUntil} onChange={(e) => setRunUntil(e.target.value)} />
            </div>
            {kind === "ad" && (
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
            )}
          </div>
        )}

        {RECURRING_SCHEDULABLE_KINDS.includes(kind) && (
          <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">
              Wiederkehrendes Zeitfenster (optional)
            </Label>
            <p className="text-xs text-muted-foreground">
              Läuft nur an ausgewählten Wochentagen bzw. Uhrzeiten – leer lassen für keine
              Einschränkung.
            </p>
            <WeekdayToggle value={scheduleDays} onChange={setScheduleDays} />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Von</Label>
                <Input
                  type="time"
                  value={scheduleTimeFrom}
                  onChange={(e) => setScheduleTimeFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Bis</Label>
                <Input
                  type="time"
                  value={scheduleTimeUntil}
                  onChange={(e) => setScheduleTimeUntil(e.target.value)}
                />
              </div>
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
            <MediaRow key={m.id} media={m} update={update} remove={remove} />
          ))}
        </div>
      </section>
    </div>
  );
}

/** "2026-03-05" aus einem Epoch-ms-Zeitstempel, fürs date-Input – leer, wenn kein Wert gesetzt ist. */
function dateInputValue(ms?: number): string {
  return ms ? new Date(ms).toISOString().slice(0, 10) : "";
}

/** Ein Eintrag der Bibliothek – normal nur die Übersicht, per "Bearbeiten" ein kleines Inline-
 *  Formular (Slot + Zeitraum, bei Werbung zusätzlich Spots/Stunde), damit ein einmal hochgeladenes
 *  Jingle/Slogan/Werbespot nicht für jede Änderung erst gelöscht und neu hochgeladen werden muss. */
function MediaRow({
  media: m,
  update,
  remove,
}: {
  media: MediaRecord;
  update: (id: string, patch: Partial<Omit<MediaRecord, "id" | "kind" | "blob">>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [slot, setSlot] = useState<NonNullable<MediaRecord["slot"]>>(m.slot ?? "allgemein");
  const [runFrom, setRunFrom] = useState(dateInputValue(m.runFrom));
  const [runUntil, setRunUntil] = useState(dateInputValue(m.runUntil));
  const [perHour, setPerHour] = useState(String(m.perHour ?? 2));
  const [scheduleDays, setScheduleDays] = useState<number[]>(m.scheduleDays ?? []);
  const [scheduleTimeFrom, setScheduleTimeFrom] = useState(m.scheduleTimeFrom ?? "");
  const [scheduleTimeUntil, setScheduleTimeUntil] = useState(m.scheduleTimeUntil ?? "");
  const [saving, setSaving] = useState(false);
  const recurring = m.kind === "jingle" || m.kind === "slogan";

  const startEdit = () => {
    setSlot(m.slot ?? "allgemein");
    setRunFrom(dateInputValue(m.runFrom));
    setRunUntil(dateInputValue(m.runUntil));
    setPerHour(String(m.perHour ?? 2));
    setScheduleDays(m.scheduleDays ?? []);
    setScheduleTimeFrom(m.scheduleTimeFrom ?? "");
    setScheduleTimeUntil(m.scheduleTimeUntil ?? "");
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await update(m.id, {
        slot: recurring ? slot : m.slot,
        runFrom: runFrom ? new Date(runFrom).getTime() : undefined,
        runUntil: runUntil ? new Date(runUntil).getTime() : undefined,
        perHour: m.kind === "ad" ? Number(perHour) || 1 : m.perHour,
        scheduleDays: recurring && scheduleDays.length ? scheduleDays : undefined,
        scheduleTimeFrom: recurring && scheduleTimeFrom ? scheduleTimeFrom : undefined,
        scheduleTimeUntil: recurring && scheduleTimeUntil ? scheduleTimeUntil : undefined,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
        <p className="truncate text-sm font-semibold">{m.title}</p>
        {(m.kind === "jingle" || m.kind === "slogan") && (
          <Select value={slot} onValueChange={(v) => setSlot(v as typeof slot)}>
            <SelectTrigger className="h-8 text-xs">
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
        )}
        <div className={`grid gap-2 ${m.kind === "ad" ? "grid-cols-3" : "grid-cols-2"}`}>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Läuft ab</Label>
            <Input
              type="date"
              className="h-8 text-xs"
              value={runFrom}
              onChange={(e) => setRunFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">bis</Label>
            <Input
              type="date"
              className="h-8 text-xs"
              value={runUntil}
              onChange={(e) => setRunUntil(e.target.value)}
            />
          </div>
          {m.kind === "ad" && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Spots/Stunde</Label>
              <Input
                type="number"
                min={1}
                max={6}
                className="h-8 text-xs"
                value={perHour}
                onChange={(e) => setPerHour(e.target.value)}
              />
            </div>
          )}
        </div>
        {recurring && (
          <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-2">
            <Label className="text-xs text-muted-foreground">
              Wiederkehrendes Zeitfenster (optional)
            </Label>
            <WeekdayToggle value={scheduleDays} onChange={setScheduleDays} />
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="time"
                className="h-8 text-xs"
                value={scheduleTimeFrom}
                onChange={(e) => setScheduleTimeFrom(e.target.value)}
              />
              <Input
                type="time"
                className="h-8 text-xs"
                value={scheduleTimeUntil}
                onChange={(e) => setScheduleTimeUntil(e.target.value)}
              />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            <X className="size-3.5" /> Abbrechen
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? "Speichert…" : "Speichern"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{m.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {KINDS.find((k) => k.id === m.kind)?.label} · {m.artist || m.category} ·{" "}
          {formatClock(m.duration)}
          {m.slot && m.slot !== "allgemein" ? ` · ${SLOTS.find((s) => s.id === m.slot)?.label}` : ""}
          {m.runFrom || m.runUntil
            ? ` · ${dateInputValue(m.runFrom) || "…"} – ${dateInputValue(m.runUntil) || "…"}`
            : ""}
          {m.scheduleDays?.length ? ` · ${weekdaysSummary(m.scheduleDays)}` : ""}
          {m.scheduleTimeFrom && m.scheduleTimeUntil
            ? ` · ${m.scheduleTimeFrom}–${m.scheduleTimeUntil} Uhr`
            : ""}
          {m.streamUrl ? " · Online (CC)" : ""}
        </p>
      </div>
      {m.kind !== "recording" && (
        <Button variant="ghost" size="icon" onClick={startEdit}>
          <Pencil className="size-4" />
        </Button>
      )}
      <Button variant="ghost" size="icon" onClick={() => void remove(m.id)}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
