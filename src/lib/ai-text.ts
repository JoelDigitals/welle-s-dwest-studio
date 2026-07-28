/**
 * Gemeinsame Textgenerierung mit Fallback: Gemini zuerst (kostenlos), bei
 * Überlastung/Fehler automatisch Groq (ebenfalls kostenlos), falls konfiguriert.
 * So bleibt Moderationstext/Newsroom auch nutzbar, wenn Geminis Freikontingent
 * gerade ausgeschöpft oder das Modell überlastet ist.
 */

export class AiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type GenerateOptions = {
  system: string;
  user: string;
  temperature?: number;
  topP?: number;
  /** Antwort als JSON-Objekt anfordern (für den Newsroom). */
  json?: boolean;
};

type ProviderResult = { ok: true; text: string } | { ok: false; status: number; detail: string };

async function callGemini(
  opts: GenerateOptions & { apiKey: string; model: string },
): Promise<ProviderResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${opts.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: [{ text: opts.user }] }],
        generationConfig: {
          temperature: opts.temperature,
          topP: opts.topP,
          ...(opts.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, status: res.status, detail };
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim() ?? "";
  return { ok: true, text };
}

async function callGroq(
  opts: GenerateOptions & { apiKey: string; model: string },
): Promise<ProviderResult> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: opts.temperature,
      top_p: opts.topP,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, status: res.status, detail };
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  return { ok: true, text };
}

function friendly(provider: string, r: Extract<ProviderResult, { ok: false }>) {
  if (r.status === 429) return `${provider}: Freikontingent gerade ausgeschöpft`;
  if (r.status === 503) return `${provider}: Modell aktuell überlastet`;
  return `${provider} (${r.status}): ${r.detail || "leere Antwort"}`.slice(0, 300);
}

export async function generateText(
  opts: GenerateOptions,
): Promise<{ text: string; provider: "gemini" | "groq" }> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  if (!geminiKey && !groqKey) {
    throw new AiError("AI ist nicht konfiguriert. GEMINI_API_KEY oder GROQ_API_KEY fehlt.", 500);
  }

  const attempts: string[] = [];

  if (geminiKey) {
    const geminiModel = process.env.GEMINI_TEXT_MODEL || "gemini-flash-latest";
    const r = await callGemini({ ...opts, apiKey: geminiKey, model: geminiModel });
    if (r.ok && r.text) return { text: r.text, provider: "gemini" };
    attempts.push(friendly("Gemini", r as Extract<ProviderResult, { ok: false }>));
  }

  if (groqKey) {
    const groqModel = process.env.GROQ_TEXT_MODEL || "llama-3.3-70b-versatile";
    const r = await callGroq({ ...opts, apiKey: groqKey, model: groqModel });
    if (r.ok && r.text) return { text: r.text, provider: "groq" };
    attempts.push(friendly("Groq", r as Extract<ProviderResult, { ok: false }>));
  }

  const suffix = geminiKey && groqKey ? " Auch der Groq-Fallback ist gerade nicht verfügbar." : "";
  throw new AiError(`Textgenerierung fehlgeschlagen: ${attempts.join(" / ")}.${suffix}`, 503);
}
