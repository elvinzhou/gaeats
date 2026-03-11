import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createScriptPrisma } from "./lib/db.js";
import { upsertFaaAirportWithLocation } from "./lib/postgis.js";
import {
  getCurrentNasrEdition,
  loadAptTextFromZipBytes,
  mapNasrAptRecord,
} from "./lib/faa-utils.js";
import { chooseNextPoiSyncAt } from "./lib/sync-utils.js";

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(
    "Usage: node scripts/import-faa-airports.js [--edition=current|next] [--file=path/to/APT.txt|faa.zip] [--url=https://faa-source.zip] [--dataset=faa-cycle-id] [--dry-run]"
  );
  process.exit(0);
}

const editionArg = [...args].find((arg) => arg.startsWith("--edition="));
const fileArg = [...args].find((arg) => arg.startsWith("--file="));
const urlArg = [...args].find((arg) => arg.startsWith("--url="));
const datasetArg = [...args].find((arg) => arg.startsWith("--dataset="));
const dryRun = args.has("--dry-run");

const requestedEdition = editionArg?.replace("--edition=", "") ?? "current";
const prisma = createScriptPrisma();

try {
  const edition = urlArg
    ? {
        downloadUrl: urlArg.replace("--url=", ""),
        dataset:
          datasetArg?.replace("--dataset=", "") ?? `faa-nasr-${requestedEdition}-manual`,
      }
    : await getCurrentNasrEdition(createEditionFetcher(requestedEdition));

  const aptText = await loadAptText({
    filePath: fileArg?.replace("--file=", ""),
    url: edition.downloadUrl,
  });

  const records = aptText
    .split(/\r?\n/)
    .map((line) => mapNasrAptRecord(line, datasetArg?.replace("--dataset=", "") ?? edition.dataset))
    .filter(Boolean);

  if (records.length === 0) {
    throw new Error("No valid FAA APT airport rows were parsed.");
  }

  const initialNextSyncAt = chooseNextPoiSyncAt({
    airportCount: records.length,
    desiredCycleDays: 30,
  });

  for (const airport of records) {
    if (dryRun) {
      console.log(`[dry-run] would import FAA airport ${airport.code}`);
      continue;
    }

    await upsertFaaAirportWithLocation(prisma, airport, initialNextSyncAt);

    console.log(`imported FAA airport ${airport.code}`);
  }
} finally {
  await prisma.$disconnect();
}

function createEditionFetcher(requestedEdition) {
  return (url, options) => {
    const nextUrl = new URL(url);
    nextUrl.searchParams.set("edition", requestedEdition);
    return fetch(nextUrl, options);
  };
}

async function loadAptText({ filePath, url }) {
  if (filePath) {
    const fileBuffer = await readFile(resolve(process.cwd(), filePath));
    if (filePath.toLowerCase().endsWith(".zip")) {
      return loadAptTextFromZipBytes(fileBuffer, "apt.txt");
    }

    return fileBuffer.toString("utf8");
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`FAA airport import failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("zip") && !response.url.toLowerCase().endsWith(".zip")) {
    return response.text();
  }

  const archiveBuffer = await response.arrayBuffer();
  return loadAptTextFromZipBytes(new Uint8Array(archiveBuffer), "apt.txt");
}
