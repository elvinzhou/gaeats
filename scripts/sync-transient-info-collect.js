import "dotenv/config";
import { createScriptPrisma } from "./lib/db.js";

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(
    "Usage: node scripts/sync-transient-info-collect.js [--job-id=N] [--dry-run]"
  );
  console.log("");
  console.log("  --job-id=N   Collect a specific job (default: all PENDING jobs)");
  console.log("  --dry-run    Print what would be written, do not modify DB");
  process.exit(0);
}

const jobIdArg = [...args].find((a) => a.startsWith("--job-id="))?.replace("--job-id=", "");
const jobId = jobIdArg ? parseInt(jobIdArg, 10) : null;
const dryRun = args.has("--dry-run");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

const prisma = createScriptPrisma();

try {
  const where = jobId ? { id: jobId, status: "PENDING" } : { status: "PENDING" };
  const jobs = await prisma.transientSyncJob.findMany({ where, orderBy: { createdAt: "asc" } });

  if (jobs.length === 0) {
    console.log("No pending jobs.");
    process.exit(0);
  }

  let anyFailed = false;

  for (const job of jobs) {
    console.log(`\n--- Job ${job.id}: ${job.geminiJobName} (submitted ${job.createdAt.toISOString()}) ---`);

    const batchData = await getBatchStatus(job.geminiJobName);
    // Handle both wrapped ({batch: {...}}) and unwrapped response shapes
    const batch = batchData.batch ?? batchData;
    const state = batch.state;
    console.log(`  State: ${state}`);
    if (state === undefined) {
      console.log(`  Raw response: ${JSON.stringify(batchData, null, 2)}`);
    }

    if (state === "JOB_STATE_PENDING" || state === "JOB_STATE_RUNNING") {
      console.log("  Still in progress — check back later");
      continue;
    }

    if (state === "JOB_STATE_FAILED" || state === "JOB_STATE_CANCELLED" || state === "JOB_STATE_EXPIRED") {
      console.error(`  Job ended with terminal state: ${state}`);
      if (!dryRun) {
        await prisma.transientSyncJob.update({ where: { id: job.id }, data: { status: "FAILED" } });
      }
      anyFailed = true;
      continue;
    }

    if (state !== "JOB_STATE_SUCCEEDED") {
      console.warn(`  Unknown state: ${state} — skipping`);
      continue;
    }

    const airports = JSON.parse(job.airportsJson);
    const inlinedResponses = batch.dest?.inlinedResponses ?? [];
    console.log(`  ${inlinedResponses.length} responses for ${airports.length} airports`);

    // Build code→airport map for metadata.key matching; fall back to positional index
    const airportByCode = new Map(airports.map((a) => [a.code, a]));

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < inlinedResponses.length; i++) {
      const inlined = inlinedResponses[i];
      const airport = airportByCode.get(inlined.metadata?.key) ?? airports[i];

      if (!airport) {
        console.warn(`  Response[${i}] has no matching airport`);
        failed++;
        continue;
      }

      const label = `${airport.code} (${airport.city} ${airport.state ?? ""})`;

      if (inlined.error) {
        // Leave nextSyncAt untouched so this airport re-enters the queue next run
        console.warn(`  ${label}: request error — ${inlined.error.message} (will retry next batch)`);
        failed++;
        continue;
      }

      const candidate = inlined.response?.candidates?.[0];
      const text = (candidate?.content?.parts ?? [])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("");

      const extraction = parseJson(text);

      if (!extraction?.notes) {
        console.log(`  ${label}: no transient info found (confidence: ${extraction?.confidence ?? "n/a"})`);
        if (!dryRun) {
          await prisma.$executeRaw`
            UPDATE "airports" SET
              "transientParkingLastSyncAt" = CURRENT_TIMESTAMP,
              "updatedAt"                  = CURRENT_TIMESTAMP
            WHERE id = ${airport.id}
          `;
        }
        skipped++;
        continue;
      }

      console.log(`  ${label}: ${extraction.confidence} — "${extraction.notes.slice(0, 100)}"`);
      console.log(`    location: ${extraction.locationDescription ?? "(none)"}`);

      if (extraction.confidence === "HIGH" && extraction.locationDescription) {
        try {
          const coords = await synthesizeCoordinates(airport, extraction.locationDescription);
          if (coords) {
            console.log(`    ramp coords: (${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)})`);
            extraction.rampLatitude = coords.latitude;
            extraction.rampLongitude = coords.longitude;
          } else {
            console.log(`    location too vague to estimate coords`);
          }
        } catch (err) {
          console.warn(`    GPT-4o synthesis failed: ${err.message}`);
        }
      }

      if (dryRun) {
        console.log(`    [dry-run] would write to DB`);
        processed++;
        continue;
      }

      await prisma.$executeRaw`
        UPDATE "airports" SET
          "transientParkingNotes"      = ${extraction.notes},
          "transientParkingSource"     = ${"GEMINI_BATCH"},
          "transientParkingConfidence" = ${extraction.confidence},
          "transientParkingLastSyncAt" = CURRENT_TIMESTAMP,
          "rampLatitude"               = COALESCE(${extraction.rampLatitude ?? null}, "rampLatitude"),
          "rampLongitude"              = COALESCE(${extraction.rampLongitude ?? null}, "rampLongitude"),
          "updatedAt"                  = CURRENT_TIMESTAMP
        WHERE id = ${airport.id}
      `;
      processed++;
    }

    if (!dryRun) {
      await prisma.transientSyncJob.update({
        where: { id: job.id },
        data: { status: "DONE" },
      });
    }

    console.log(`\n  Done — processed: ${processed}  skipped: ${skipped}  failed: ${failed}`);
    if (failed > 0) anyFailed = true;
  }

  if (anyFailed) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

// ---------------------------------------------------------------------------
// Gemini Batch API
// ---------------------------------------------------------------------------

async function getBatchStatus(batchName) {
  const url = `${GEMINI_BASE}/${batchName}?key=${GEMINI_API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini batch status HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// GPT-4o coordinate synthesis
// ---------------------------------------------------------------------------

async function synthesizeCoordinates(airport, locationDescription) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
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
          content: `Airport: ${airport.code} — ${airport.name}\nARP: ${airport.latitude.toFixed(6)}, ${airport.longitude.toFixed(6)}\nTransient area: "${locationDescription}"\n\nEstimate the GPS coordinate.`,
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
