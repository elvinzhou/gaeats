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

    const { text, groundingMetadata, tokensUsed } = await callGeminiGrounded(code);

    // Log grounding details
    const queries = groundingMetadata?.webSearchQueries ?? [];
    const chunks = groundingMetadata?.groundingChunks ?? [];
    log(`  -> Search queries issued by Gemini: ${queries.length}`);
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

    // Parse structured JSON from response
    const extraction = parseJson(text);
    if (extraction) {
      result.notes = extraction.notes;
      result.confidence = extraction.confidence;
      result.locationDescription = extraction.locationDescription;
      log(`  -> Parsed: confidence=${extraction.confidence}`);
    } else {
      log(`  -> Could not parse JSON from response`);
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

async function callGeminiGrounded(code, attempt = 1) {
  const prompt = `Search for transient (visiting/overnight) aircraft parking information for ${code} airport.

Find: where exactly on the airport visiting pilots park their aircraft — specific ramp name, location relative to landmarks, self-serve fuel, FBO, etc. Also note any overnight fees, restrictions, or tie-down costs if mentioned.

Respond with a JSON object (no markdown fences) with these exact fields:
- "notes": string — 1-3 sentences summarising transient parking location and any costs. null if nothing found.
- "confidence": "HIGH" | "MEDIUM" | "LOW"
- "locationDescription": string | null — plain-language WHERE on the airport (e.g. "north ramp near self-serve fuel pump", "main FBO on the west side of the field"). null if unknown.`;

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

  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    const delay = attempt * 5000;
    log(`  -> Rate limited — retrying in ${delay / 1000}s`);
    await new Promise((r) => setTimeout(r, delay));
    return callGeminiGrounded(code, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini HTTP ${response.status}: ${body.slice(0, 400)}`);
  }

  const data = await response.json();

  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const groundingMetadata = candidate?.groundingMetadata ?? null;
  const tokensUsed =
    (data.usageMetadata?.promptTokenCount ?? 0) +
    (data.usageMetadata?.candidatesTokenCount ?? 0);

  return { text, groundingMetadata, tokensUsed };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function parseJson(text) {
  try {
    return JSON.parse(text.trim());
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

function log(msg) {
  process.stdout.write(msg + "\n");
}
