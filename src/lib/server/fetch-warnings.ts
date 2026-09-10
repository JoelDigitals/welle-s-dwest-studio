/** Amtliche Warnmeldungen (Bevölkerungsschutz, Wetter, Polizei, Hochwasser – dieselbe Quelle wie
 *  die NINA-Warn-App und Cell Broadcast/"Warntag") von der offiziellen BBK-Schnittstelle
 *  warnung.bund.de. Kein API-Key nötig, öffentlich dokumentiert (gegen den echten Server geprüft). */
import { berlinDateKey } from "@/lib/berlin-time";

const SOURCES = ["mowas", "dwd", "katwarn", "police", "lhp", "biwapp"] as const;
type Source = (typeof SOURCES)[number];

type MapEntry = {
  id: string;
  version: number;
  startDate: string;
  severity: string;
  urgency: string;
  type: string;
  i18nTitle?: { de?: string };
};

export type CivilWarning = {
  /** "<id>:<version>" – eindeutig je Aktualisierung, für die "schon vorgelesen"-Markierung. */
  key: string;
  id: string;
  version: number;
  region: "Saarland" | "Rheinland-Pfalz";
  source: Source;
  severity: string;
  urgency: string;
  /** "Alert" (neu/aktualisiert) oder "Cancel" (Entwarnung). */
  type: string;
  headline: string;
  description: string;
  instruction: string;
  areas: string[];
  startDate: string;
  /** Wann genau DIESE Version (Warnung oder Entwarnung) verschickt wurde (CAP "sent") – dient dem
   *  Nur-heute-Filter, damit z. B. am Warntag nur die 11-Uhr-Warnung und die 11:45-Uhr-Entwarnung
   *  desselben Tages gesendet werden, nicht auch länger zurückliegende, noch aktive Warnungen. */
  sent: string;
};

async function fetchWithTimeout(url: string, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** BBK-Fließtext enthält "<br/>"-Umbrüche statt echter Absätze – zu gesprochenen Sätzen glätten. */
function cleanText(value: string | undefined): string {
  if (!value) return "";
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\*{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Region aus der ID ableiten ("mow.DE-SL-..." → Saarland, "mow.DE-RP-..." → Rheinland-Pfalz). */
function regionOf(id: string): "Saarland" | "Rheinland-Pfalz" | null {
  if (/-SL-/.test(id)) return "Saarland";
  if (/-RP-/.test(id)) return "Rheinland-Pfalz";
  return null;
}

async function fetchDetail(source: Source, entry: MapEntry): Promise<CivilWarning | null> {
  const region = regionOf(entry.id);
  if (!region) return null;
  try {
    const res = await fetchWithTimeout(
      `https://warnung.bund.de/api31/warnings/${encodeURIComponent(entry.id)}.json`,
      8000,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      msgType?: string;
      sent?: string;
      info?: Array<{
        language?: string;
        headline?: string;
        description?: string;
        instruction?: string;
        area?: Array<{ areaDesc?: string }>;
      }>;
    };
    // "de" ist der reguläre Text, "de-LS" eine separate Leichte-Sprache-Variante – nur den
    // regulären Text verwenden, sonst kämen beide Fassungen doppelt vor.
    const info = data.info?.find((i) => i.language === "de") ?? data.info?.[0];
    if (!info) return null;
    return {
      key: `${entry.id}:${entry.version}`,
      id: entry.id,
      version: entry.version,
      region,
      source,
      severity: entry.severity,
      urgency: entry.urgency,
      type: data.msgType === "Cancel" ? "Cancel" : entry.type,
      headline: cleanText(info.headline) || cleanText(entry.i18nTitle?.de),
      description: cleanText(info.description),
      instruction: cleanText(info.instruction),
      areas: (info.area ?? []).map((a) => cleanText(a.areaDesc)).filter(Boolean),
      startDate: entry.startDate,
      sent: data.sent ?? entry.startDate,
    };
  } catch {
    return null;
  }
}

export type WarningsResult = {
  fetchedAt: string;
  items: CivilWarning[];
};

/** Holt aktuelle amtliche Warnungen für Saarland/Rheinland-Pfalz aus allen sechs BBK-Quellen. */
export async function fetchWarnings(): Promise<WarningsResult> {
  const perSource = await Promise.all(
    SOURCES.map(async (source) => {
      try {
        const res = await fetchWithTimeout(`https://warnung.bund.de/api31/${source}/mapData.json`, 8000);
        if (!res.ok) return [] as MapEntry[];
        const all = (await res.json()) as MapEntry[];
        return all.filter((e) => regionOf(e.id));
      } catch {
        return [] as MapEntry[];
      }
    }),
  );

  const relevant = SOURCES.flatMap((source, i) => perSource[i].map((entry) => ({ source, entry })));
  const details = await Promise.all(relevant.map(({ source, entry }) => fetchDetail(source, entry)));

  // Nur Warnungen (und Entwarnungen), die HEUTE (Berlin-Kalendertag) tatsächlich verschickt
  // wurden – ein Warntag-Test um 11 Uhr mit Entwarnung um 11:45 Uhr soll nur an diesem einen Tag
  // laufen, nicht noch tagelang als "aktive" Warnung nachwirken.
  const today = berlinDateKey(Date.now());
  return {
    fetchedAt: new Date().toISOString(),
    items: details
      .filter((w): w is CivilWarning => Boolean(w))
      .filter((w) => berlinDateKey(new Date(w.sent).getTime()) === today),
  };
}
