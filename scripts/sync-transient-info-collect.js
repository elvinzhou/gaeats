import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { createScriptPrisma } from "./lib/db.js";
import { extractResponseText, parseJson } from "./lib/gemini-utils.js";
import { listAirportFbos } from "./lib/postgis.js";
import { resolveRampCoordinates } from "./lib/ramp-coordinates.js";

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
const GOOGLE_MAPS_SERVER_API_KEY = process.env.GOOGLE_MAPS_SERVER_API_KEY;

if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required");
// Coordinate resolution degrades gracefully without these (it can still snap to
// known FBO coordinates), so they're optional — just warn.
if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY not set — GPT-4o ramp estimation disabled.");
if (!GOOGLE_MAPS_SERVER_API_KEY) console.warn("GOOGLE_MAPS_SERVER_API_KEY not set — Google Places ramp geocoding disabled.");

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
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

    const batchJob = await ai.batches.get({ name: job.geminiJobName });
    const state = batchJob.state;
    console.log(`  State: ${state}`);

    if (state === "JOB_STATE_PENDING" || state === "JOB_STATE_RUNNING") {
      console.log("  Still in progress — check back later");
      continue;
    }

    if (state === "JOB_STATE_FAILED" || state === "JOB_STATE_CANCELLED" || state === "JOB_STATE_EXPIRED") {
      console.error(`  Job ended with terminal state: ${state}`);
      if (batchJob.error) {
        const msg = typeof batchJob.error === "string" ? batchJob.error : batchJob.error.message ?? JSON.stringify(batchJob.error);
        console.error(`  Error: ${msg}`);
      }
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
    const inlinedResponses = batchJob.dest?.inlinedResponses ?? [];
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
        // Leave lastSyncAt untouched so this airport re-enters the queue next run
        console.warn(`  ${label}: request error — ${inlined.error} (will retry next batch)`);
        failed++;
        continue;
      }

      // `inlined.response` is a plain object from batches.get(), so the SDK's
      // `.text` getter is absent — walk candidates/parts ourselves.
      const text = extractResponseText(inlined.response);
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
          const fbos = await listAirportFbos(prisma, airport.id);
          const coords = await resolveRampCoordinates({
            airport,
            extraction,
            fbos,
            env: { OPENAI_API_KEY, GOOGLE_MAPS_SERVER_API_KEY },
          });
          if (coords) {
            console.log(`    ramp coords: (${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}) via ${coords.source} — ${coords.reasoning}`);
            extraction.rampLatitude = coords.latitude;
            extraction.rampLongitude = coords.longitude;
          } else {
            console.log(`    no ramp/FBO coordinate could be resolved`);
          }
        } catch (err) {
          console.warn(`    ramp coordinate resolution failed: ${err.message}`);
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

