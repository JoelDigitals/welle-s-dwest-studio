/**
 * Best-effort Volltext-Extraktion einer Nachrichtenseite über ihren Original-Link – die RSS-Feeds
 * selbst liefern nur 1-3 Sätze (siehe fetch-news.ts, geprüft gegen die echten Feeds: description
 * UND content:encoded enthalten praktisch denselben kurzen Text, keine versteckte Langfassung).
 * Für einen wirklich ausführlichen KI-Artikel ("ein Großteil der Nachrichten der Textquelle")
 * braucht es also den echten Artikeltext von der verlinkten Seite selbst, nicht nur den Teaser.
 *
 * Bewusst ohne HTML-Parser-Bibliothek (wie der Rest der Feed-Verarbeitung, siehe fetch-news.ts) -
 * ein einfacher, aber robuster Regex-Ansatz: störende Blöcke (Skripte/Navigation/Footer) raus,
 * dann alle <p>-Absätze einsammeln. Rein heuristisch und best-effort: schlägt die Extraktion fehl
 * oder liefert zu wenig, gibt die Funktion null zurück und der Aufrufer fällt auf den RSS-Text
 * zurück (siehe news-articles-store.ts).
 */

const FETCH_TIMEOUT_MS = 6_000;
const MAX_CHARS = 6_000;
const MIN_PARAGRAPH_CHARS = 40;

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; WelleSuedwestBot/1.0; +https://welle-sued-west-studio.onrender.com)",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, "&");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Entfernt ganze Blöcke, die nie zum eigentlichen Artikeltext gehören. */
function removeNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, "");
}

/** Liefert den (mutmaßlichen) Artikeltext einer Nachrichtenseite, oder null bei Fehlschlag -
 *  wirft nie. */
export async function fetchArticleFullText(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return null;
    const html = removeNoise(await res.text());

    const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => stripTags(m[1]))
      .filter((p) => p.length >= MIN_PARAGRAPH_CHARS);

    if (paragraphs.length < 2) return null;

    const text = paragraphs.join("\n\n").slice(0, MAX_CHARS);
    return text || null;
  } catch {
    return null;
  }
}
