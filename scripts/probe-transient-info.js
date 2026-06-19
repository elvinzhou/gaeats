/**
 * Proof-of-concept: transient parking info via Gemini 2.5 Flash + Google Search grounding
 *
 * Replaces the AirNav scrape → Brave Search → website scrape pipeline with a single
 * grounded Gemini call. Gemini searches Google internally and cites its sources.
 *
 * Usage:
 *   node scripts/probe-transient-info.js [--airports=KPAO,KSQL,KRHV]
 *
 * Required env:
 *   GEMINI_API_KEY
 */

import "dotenv/config";

const DEFAULT_AIRPORTS = ["KPAO", "KSQL", "KRHV"];

const airportArg = process.argv.slice(2).find((a) => a.startsWith("--airports="));
const AIRPORTS = airportArg
  ? airportArg.replace("--airports=", "").toUpperCase().split(",").map((s) => s.trim())
  : DEFAULT_AIRPORTS;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const results = [];

for (const code of AIRPORTS) {
  log(`\n${"=".repeat(60)}`);
  log(`AIRPORT: ${code}`);
  log("=".repeat(60));

  const result = { code, notes: null, confidence: null, locationDescription: null, sources: [], error: null };

  try {
    log(`\n[1/1] Calling Gemini 2.5 Flash with Google Search grounding...`);

    const response = await callGeminiGrounded(code);

    if (!response) {
      log(`  -> Gemini returned no result after retries`);
    } else {
      const { text, groundingMetadata, tokensUsed, searchCount } = response;

      // Log grounding details
      const queries = groundingMetadata?.webSearchQueries ?? [];
      const chunks = groundingMetadata?.groundingChunks ?? [];
      log(`  -> Searches issued: ${searchCount}`);
      queries.forEach((q, i) => log(`     ${i + 1}. "${q}"`));
      log(`  -> Sources retrieved: ${chunks.length}`);
      chunks.forEach((c, i) => {
        const uri = c.web?.uri ?? "(unknown)";
        const title = c.web?.title ?? "";
        log(`     ${i + 1}. ${title} — ${uri}`);
        result.sources.push({ title, uri });
      });
      log(`  -> Tokens used: ~${tokensUsed}`);
      log(`  -> Raw response:\n${text.replace(/^/gm, "     ")}`);

      // Parse structured JSON from response (handles markdown fences)
      const extraction = parseJson(text);
      if (extraction) {
        result.notes = extraction.notes;
        result.confidence = extraction.confidence;
        result.locationDescription = extraction.locationDescription;
        log(`  -> Parsed: confidence=${extraction.confidence}`);
      } else {
        log(`  -> Could not parse JSON from response`);
      }
    }
  } catch (err) {
    log(`\nERROR: ${err.message}`);
    log(err.stack);
    result.error = err.message;
  }

  results.push(result);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

log(`\n${"=".repeat(60)}`);
log("SUMMARY");
log("=".repeat(60));

for (const r of results) {
  log(`\n${r.code}`);
  log(`  confidence: ${r.confidence ?? "(none)"}`);
  log(`  notes:      ${r.notes ?? "(none)"}`);
  log(`  location:   ${r.locationDescription ?? "(none)"}`);
  log(`  sources:    ${r.sources.length}`);
  r.sources.forEach((s) => log(`    - ${s.title} — ${s.uri}`));
  if (r.error) log(`  error:      ${r.error}`);
}

log("\n--- JSON output ---");
console.log(JSON.stringify(results, null, 2));

// ---------------------------------------------------------------------------
// Gemini 2.5 Flash with Google Search grounding
// ---------------------------------------------------------------------------

async function callGeminiGrounded(code, forceSearch = false, attempt = 1) {
  const prompt = forceSearch
    ? `Search the web right now — do not use training data — for current transient aircraft parking at ${code} airport. Where exactly can visiting pilots park? Include ramp name, location, fees, restrictions.

Respond with raw JSON only (no markdown):
{"notes": "...", "confidence": "HIGH|MEDIUM|LOW", "locationDescription": "..."}`
    : `Search for transient (visiting/overnight) aircraft parking at ${code} airport. Where exactly on the airport can visiting pilots park — specific ramp, location relative to landmarks, FBO, self-serve fuel? Include overnight fees or restrictions if mentioned.

Respond with raw JSON only (no markdown):
{"notes": "...", "confidence": "HIGH|MEDIUM|LOW", "locationDescription": "..."}

Return {"notes":null,"confidence":"LOW","locationDescription":null} if nothing found.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tools: [{ googleSearch: {} }],
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
      }),
    }
  );

  log(`  -> Gemini response status: ${response.status}`);

  // 503 = model overloaded — retry up to 5 times with longer backoff
  if (response.status === 503 && attempt <= 5) {
    const delay = Math.min(attempt * 15000, 60000);
    log(`  -> 503 overloaded — retry ${attempt}/5 in ${delay / 1000}s`);
    await new Promise((r) => setTimeout(r, delay));
    return callGeminiGrounded(code, forceSearch, attempt + 1);
  }

  // 429 = rate limited
  if (response.status === 429 && attempt <= 3) {
    const delay = attempt * 10000;
    log(`  -> 429 rate limited — retry ${attempt}/3 in ${delay / 1000}s`);
    await new Promise((r) => setTimeout(r, delay));
    return callGeminiGrounded(code, forceSearch, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini HTTP ${response.status}: ${body.slice(0, 400)}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];

  // Filter out thinking tokens before joining text
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");

  const groundingMetadata = candidate?.groundingMetadata ?? null;
  const tokensUsed =
    (data.usageMetadata?.promptTokenCount ?? 0) +
    (data.usageMetadata?.candidatesTokenCount ?? 0);
  const searchCount = groundingMetadata?.webSearchQueries?.length ?? 0;

  // If Gemini answered from training data without searching, retry once with
  // an explicit instruction to search the web
  if (searchCount === 0 && !forceSearch) {
    log(`  -> 0 searches made — retrying with explicit search instruction`);
    return callGeminiGrounded(code, true, 1);
  }

  return { text, groundingMetadata, tokensUsed, searchCount };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function parseJson(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

function log(msg) {
  process.stdout.write(msg + "\n");
}
