import "dotenv/config";
import { createScriptPrisma } from "./lib/db.js";

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log("Usage: node scripts/reset-transient-sync.js [--airport=KPAO] [--full]");
  console.log("");
  console.log("  --airport=CODE  Reset a specific airport only");
  console.log("  --full          Also clear notes, source, and confidence (full data wipe)");
  console.log("");
  console.log("NULLs transientParkingNextSyncAt so airports re-enter the sync queue.");
  console.log("Without --full, existing notes are preserved — only the schedule is reset.");
  process.exit(0);
}

const airportFilter = [...args]
  .find((a) => a.startsWith("--airport="))
  ?.replace("--airport=", "")
  .toUpperCase();
const full = args.has("--full");

const prisma = createScriptPrisma();

try {
  if (airportFilter) {
    const result = full
      ? await prisma.$executeRaw`
          UPDATE "airports" SET
            "transientParkingNextSyncAt" = NULL,
            "transientParkingLastSyncAt" = NULL,
            "transientParkingNotes"      = NULL,
            "transientParkingSource"     = NULL,
            "transientParkingConfidence" = NULL,
            "updatedAt"                  = CURRENT_TIMESTAMP
          WHERE UPPER(code) = UPPER(${airportFilter})
        `
      : await prisma.$executeRaw`
          UPDATE "airports" SET
            "transientParkingNextSyncAt" = NULL,
            "transientParkingLastSyncAt" = NULL,
            "updatedAt"                  = CURRENT_TIMESTAMP
          WHERE UPPER(code) = UPPER(${airportFilter})
        `;

    console.log(`Reset ${result} airport(s) matching ${airportFilter}${full ? " (full wipe)" : ""}`);
  } else {
    const result = full
      ? await prisma.$executeRaw`
          UPDATE "airports" SET
            "transientParkingNextSyncAt" = NULL,
            "transientParkingLastSyncAt" = NULL,
            "transientParkingNotes"      = NULL,
            "transientParkingSource"     = NULL,
            "transientParkingConfidence" = NULL,
            "updatedAt"                  = CURRENT_TIMESTAMP
          WHERE "facilityType" = 'AIRPORT'
            AND ("transientStorageHangar" = true OR "transientStorageTiedown" = true)
            AND country = 'US'
        `
      : await prisma.$executeRaw`
          UPDATE "airports" SET
            "transientParkingNextSyncAt" = NULL,
            "transientParkingLastSyncAt" = NULL,
            "updatedAt"                  = CURRENT_TIMESTAMP
          WHERE "facilityType" = 'AIRPORT'
            AND ("transientStorageHangar" = true OR "transientStorageTiedown" = true)
            AND country = 'US'
        `;

    console.log(`Reset ${result} airports${full ? " (full wipe)" : ""} — all will be re-queued on next submit run`);
  }
} finally {
  await prisma.$disconnect();
}
