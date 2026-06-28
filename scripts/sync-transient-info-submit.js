import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { createScriptPrisma } from "./lib/db.js";

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(
    "Usage: node scripts/sync-transient-info-submit.js [--airport=KPAO] [--limit=1500] [--dry-run] [--force]"
  );
  console.log("");
  console.log("  --airport=CODE  Submit a single airport");
  console.log("  --limit=N       Max airports per batch (default: 1500)");
  console.log("  --dry-run       Print what would be submitted, do not call Gemini or modify DB");
  console.log("  --force         Submit even if a pending job already exists");
  process.exit(0);
}

const airportFilter = [...args]
  .find((a) => a.startsWith("--airport="))
  ?.replace("--airport=", "")
  .toUpperCase();
const limit = parseInt(
  [...args].find((a) => a.startsWith("--limit="))?.replace("--limit=", "") ?? "1500",
  10
);
const dryRun = args.has("--dry-run");
const force = args.has("--force");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required");

const GEMINI_MODEL = "gemini-2.5-flash-lite";

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const prisma = createScriptPrisma();

try {
  if (!force) {
    const pending = await prisma.transientSyncJob.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    if (pending) {
      console.log(`Pending job already exists: ${pending.geminiJobName} (id=${pending.id}, created ${pending.createdAt.toISOString()})`);
      console.log("Run sync-transient-info-collect.js to collect results, or pass --force to submit a new batch.");
      process.exit(0);
    }
  }

  const airports = await listAirportsForTransientSync(airportFilter);

  if (airports.length === 0) {
    // All airports are within their next-sync window — nothing to do
    process.exit(0);
  }

  console.log(`Preparing batch for ${airports.length} airport(s)`);

  const requests = airports.map((airport) => ({
    contents: [{ role: "user", parts: [{ text: buildPrompt(airport.code) }] }],
    config: {
      tools: [{ googleSearch: {} }],
      temperature: 0.1,
      maxOutputTokens: 512,
    },
    metadata: { key: airport.code },
  }));

  if (dryRun) {
    console.log(`[dry-run] would submit batch of ${requests.length} requests`);
    console.log(`  Sample prompt: ${requests[0].contents[0].parts[0].text.slice(0, 120)}...`);
    process.exit(0);
  }

  const displayName = `transient-sync-${new Date().toISOString().slice(0, 10)}-${Date.now()}`;
  console.log(`Submitting batch "${displayName}"...`);
  const batchName = await submitBatch(displayName, requests);

  const airportsJson = JSON.stringify(
    airports.map(({ id, code, name, city, state, latitude, longitude }) => ({
      id: Number(id),
      code,
      name,
      city,
      state: state ?? null,
      latitude: Number(latitude),
      longitude: Number(longitude),
    }))
  );

  const job = await prisma.transientSyncJob.create({
    data: {
      geminiJobName: batchName,
      status: "PENDING",
      airportsJson,
    },
  });

  console.log(`Batch submitted: ${batchName}`);
  console.log(`Job saved (id=${job.id}). Run sync-transient-info-collect.js when Gemini finishes (target: 24h).`);
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
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude
    FROM "airports"
    WHERE "facilityType" = 'AIRPORT'
      AND ("transientStorageHangar" = true OR "transientStorageTiedown" = true)
      AND country = 'US'
      AND ("transientParkingLastSyncAt" IS NULL OR "transientParkingLastSyncAt" <= CURRENT_TIMESTAMP - INTERVAL '30 days')
    ORDER BY
      "transientParkingLastSyncAt" ASC NULLS FIRST,
      CASE
        WHEN state = 'CA' AND ST_Y(location::geometry) BETWEEN 36.5 AND 39.0
             AND ST_X(location::geometry) BETWEEN -123.5 AND -121.0 THEN 1
        WHEN state IN ('CA', 'OR', 'WA') THEN 2
        ELSE 3
      END ASC,
      "syncPriority" ASC
    LIMIT ${limit}
  `;
}

// ---------------------------------------------------------------------------
// Gemini Batch API
// ---------------------------------------------------------------------------

async function submitBatch(displayName, requests) {
  const batchJob = await ai.batches.create({
    model: GEMINI_MODEL,
    src: { inlinedRequests: requests },
    config: { displayName },
  });
  if (!batchJob.name) throw new Error(`Gemini batch response has no name: ${JSON.stringify(batchJob).slice(0, 200)}`);
  return batchJob.name;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildPrompt(code) {
  return `Search the web for current transient aircraft parking at ${code} airport. Where exactly can visiting pilots park — specific ramp name, location relative to landmarks or FBO, self-serve fuel availability? Include overnight fees or restrictions if mentioned.

Respond with raw JSON only (no markdown):
{"notes": "...", "confidence": "HIGH|MEDIUM|LOW", "locationDescription": "...", "fboName": "...", "fboAddress": "..."}

- locationDescription: where on the field the transient ramp/parking is (e.g. "north tie-down apron next to the self-serve fuel").
- fboName: the exact name of the FBO or operator that hosts transient parking, if any (e.g. "Signature Flight Support"); null if none.
- fboAddress: the FBO's full street address if the results state one (e.g. "1659 Airport Blvd, San Jose, CA 95110"); null if not given. Copy it verbatim — do not guess.

Return {"notes":null,"confidence":"LOW","locationDescription":null,"fboName":null,"fboAddress":null} if nothing found.`;
}
