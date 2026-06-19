import "dotenv/config";
import { createScriptPrisma } from "./lib/db.js";

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(
    "Usage: node scripts/sync-transient-info.js [--airport=KPAO] [--limit=15] [--dry-run]"
  );
  console.log("");
  console.log("  --airport=CODE  Sync a single airport");
  console.log("  --limit=N       Max airports per run (default: 15)");
  console.log("  --dry-run       Print what would be written, do not modify DB");
  process.exit(0);
}

const airportFilter = [...args]
  .find((a) => a.startsWith("--airport="))
  ?.replace("--airport=", "")
  .toUpperCase();
const limit = parseInt(
  [...args].find((a) => a.startsWith("--limit="))?.replace("--limit=", "") ?? "15",
  10
);
const dryRun = args.has("--dry-run");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

const prisma = createScriptPrisma();

try {
  const airports = await listAirportsForTransientSync(airportFilter);
  console.log(`Processing ${airports.length} airport(s)`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const airport of airports) {
    console.log(`\n--- ${airport.code} (${airport.name}, ${airport.city} ${airport.state ?? ""}) ---`);

    try {
      const extraction = await queryGeminiGrounded(airport.code);

      if (!extraction) {
        console.log(`  no extraction returned — skipping`);
        skipped++;
        continue;
      }

      if (!extraction.notes) {
        console.log(`  no transient info found (confidence: ${extraction.confidence})`);
        skipped++;
        continue;
      }

      console.log(`  confidence: ${extraction.confidence}`);
      console.log(`  notes: ${extraction.notes.slice(0, 120)}`);
      console.log(`  location: ${extraction.locationDescription ?? "(none)"}`);

      // GPT-4o coordinate synthesis when confidence is high and location is described
      if (extraction.confidence === "HIGH" && extraction.locationDescription && OPENAI_API_KEY) {
        try {
          const coords = await synthesizeCoordinates(airport, extraction.locationDescription);
          if (coords) {
            console.log(`  GPT-4o ramp coords: (${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)})`);
            extraction.rampLatitude = coords.latitude;
            extraction.rampLongitude = coords.longitude;
          }
        } catch (err) {
          console.warn(`  GPT-4o synthesis failed: ${err.message}`);
        }
      }

      if (dryRun) {
        console.log(`  [dry-run] would write to DB`);
        processed++;
        continue;
      }

      await prisma.$executeRaw`
        UPDATE "airports" SET
          "transientParkingNotes"      = ${extraction.notes},
          "transientParkingSource"     = ${"GEMINI_GROUNDED"},
          "transientParkingConfidence" = ${extraction.confidence},
          "transientParkingLastSyncAt" = CURRENT_TIMESTAMP,
          "rampLatitude"               = COALESCE(${extraction.rampLatitude ?? null}, "rampLatitude"),
          "rampLongitude"              = COALESCE(${extraction.rampLongitude ?? null}, "rampLongitude"),
          "updatedAt"                  = CURRENT_TIMESTAMP
        WHERE id = ${airport.id}
      `;

      processed++;
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      failed++;
    }

    // 2s gap between airports — stays comfortably within free tier RPM limits
    if (!airportFilter) await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\nDone — processed: ${processed}  skipped: ${skipped}  failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

// ---------------------------------------------------------------------------
// DB query
// ---------------------------------------------------------------------------

async function listAirportsForTransientSync(airportCode) {
  if (airportCode) {
    return prisma.$queryRaw`
      SELECT
        id, code, name, city, state,
        "transientParkingLastSyncAt",
        ST_Y(location::geometry) AS latitude,
        ST_X(location::geometry) AS longitude
      FROM "airports"
      WHERE UPPER(code) = UPPER(${airportCode})
    `;
  }

  return prisma.$queryRaw`
    SELECT
      id, code, name, city, state,
      "transientParkingLastSyncAt",
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude,
      CASE
        WHEN state = 'CA' AND ST_Y(location::geometry) BETWEEN 36.5 AND 39.0
             AND ST_X(location::geometry) BETWEEN -123.5 AND -121.0 THEN 1
        WHEN state IN ('CA', 'OR', 'WA') THEN 2
        ELSE 3
      END AS "regionPriority"
    FROM "airports"
    WHERE ("facilityType" = 'AIRPORT' OR "facilityType" IS NULL)
      AND ("transientStorageHangar" = true OR "transientStorageTiedown" = true OR "facilityType" IS NULL)
      AND (country = 'US' OR country IS NULL)
    ORDER BY
      "transientParkingLastSyncAt" ASC NULLS FIRST,
      "regionPriority" ASC,
      "syncPriority" ASC
    LIMIT ${limit}
  `;
}

// ---------------------------------------------------------------------------
// Gemini 2.0 Flash with Google Search grounding
// ---------------------------------------------------------------------------

const GEMINI_MODEL = "gemini-2.5-flash-lite";

async function queryGeminiGrounded(code, forceSearch = false, attempt = 1) {
  const prompt = forceSearch
    ? `Search the web right now — do not use training data — for current transient aircraft parking information at ${code} airport. Where exactly can visiting pilots park? Include ramp name, location, fees, restrictions.

Respond with raw JSON only (no markdown):
{"notes": "...", "confidence": "HIGH|MEDIUM|LOW", "locationDescription": "..."}`
    : `Search for transient (visiting/overnight) aircraft parking at ${code} airport. Where exactly on the airport can visiting pilots park — specific ramp, location relative to landmarks, FBO, self-serve fuel? Include overnight fees or restrictions if mentioned.

Respond with raw JSON only (no markdown):
{"notes": "...", "confidence": "HIGH|MEDIUM|LOW", "locationDescription": "..."}

Return {"notes":null,"confidence":"LOW","locationDescription":null} if nothing found.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tools: [{ googleSearch: {} }],
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
      }),
    }
  );

  // 503 = model overloaded — retry up to 5 times with longer backoff
  if (response.status === 503 && attempt <= 5) {
    const delay = Math.min(attempt * 15000, 60000);
    console.warn(`  Gemini 503 (overloaded) — retry ${attempt}/5 in ${delay / 1000}s`);
    await new Promise((r) => setTimeout(r, delay));
    return queryGeminiGrounded(code, forceSearch, attempt + 1);
  }

  // 429 = rate limited — shorter backoff
  if (response.status === 429 && attempt <= 3) {
    const delay = attempt * 10000;
    console.warn(`  Gemini 429 (rate limit) — retry ${attempt}/3 in ${delay / 1000}s`);
    await new Promise((r) => setTimeout(r, delay));
    return queryGeminiGrounded(code, forceSearch, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];

  // Filter out thinking tokens (parts with thought:true) before joining text
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");

  const searchCount = candidate?.groundingMetadata?.webSearchQueries?.length ?? 0;

  // If Gemini answered from training data without searching, retry once with
  // an explicit instruction to search — common for well-known airports
  if (searchCount === 0 && !forceSearch) {
    console.warn(`  Gemini answered without searching — retrying with explicit search instruction`);
    return queryGeminiGrounded(code, true, 1);
  }

  if (searchCount === 0) {
    console.warn(`  Gemini still did not search on forced retry — skipping`);
    return null;
  }

  return parseJson(text);
}

// ---------------------------------------------------------------------------
// GPT-4o coordinate synthesis
// ---------------------------------------------------------------------------

async function synthesizeCoordinates(airport, locationDescription) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a navigation assistant estimating GPS coordinates for a transient aircraft parking area at a GA airport. Given the airport reference point and a plain-language location description, return raw JSON: {"latitude": number, "longitude": number, "reasoning": "..."}. Return null values if you cannot make a reasonable estimate.`,
        },
        {
          role: "user",
          content: `Airport: ${airport.code} — ${airport.name}\nARP: ${Number(airport.latitude).toFixed(6)}, ${Number(airport.longitude).toFixed(6)}\nTransient area: "${locationDescription}"\n\nEstimate the GPS coordinate.`,
        },
      ],
      temperature: 0.1,
      max_tokens: 200,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const parsed = parseJson(data.choices?.[0]?.message?.content ?? "");
  if (parsed?.latitude != null && parsed?.longitude != null) {
    return { latitude: parsed.latitude, longitude: parsed.longitude };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function parseJson(text) {
  // Strip markdown code fences if present
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
