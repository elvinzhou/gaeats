// Shared helpers for reading Gemini (@google/genai) responses.

/**
 * Extract the concatenated text from a Gemini `GenerateContentResponse`.
 *
 * IMPORTANT: the @google/genai SDK exposes `response.text` as a *getter* that
 * only exists on live `GenerateContentResponse` class instances. Results
 * retrieved from a batch job via `ai.batches.get()` arrive as plain,
 * deserialized JSON objects (`dest.inlinedResponses[i].response`), so the
 * `.text` getter is absent and reading it yields `undefined`. That trap is
 * what made the collect step report "no transient info found" for every
 * airport. Always walk candidates/parts yourself, mirroring the SDK getter
 * (which skips "thought"/thinking parts).
 *
 * @param {any} response - A GenerateContentResponse-shaped object.
 * @returns {string} Concatenated text from the first candidate ("" if none).
 */
export function extractResponseText(response) {
  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  let text = "";
  for (const part of parts) {
    if (typeof part?.text !== "string") continue;
    if (part.thought === true) continue; // skip thinking tokens
    text += part.text;
  }
  return text;
}

/**
 * Parse a JSON object out of an LLM text response, tolerating markdown code
 * fences and surrounding prose.
 *
 * @param {string} text - Raw model text.
 * @returns {any|null} The parsed object, or null if nothing parseable.
 */
export function parseJson(text) {
  const stripped = (text ?? "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}
