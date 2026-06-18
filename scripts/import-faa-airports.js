import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createScriptPrisma } from "./lib/db.js";
import { upsertFaaAirportWithLocation } from "./lib/postgis.js";
import {
  buildContactMap,
  getCurrentNasrCsvEdition,
  loadAptTextFromZipBytes,
  mapNasrCsvRecord,
  parseCsvRows,
} from "./lib/faa-utils.js";
import { chooseNextPoiSyncAt } from "./lib/sync-utils.js";

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(
    "Usage: node scripts/import-faa-airports.js [--edition=current|next] [--file=path/to/APT_BASE.csv|faa_csv.zip] [--url=https://faa-csv-source.zip] [--dataset=faa-cycle-id] [--dry-run]\n\nLoads FAA NASR airport data from the CSV format (APT_BASE.csv + APT_CON.csv)."
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
    : await getCurrentNasrCsvEdition(createEditionFetcher(requestedEdition));

  const dataset = datasetArg?.replace("--dataset=", "") ?? edition.dataset;

  const { aptBaseText, aptConText } = await loadCsvTexts({
    filePath: fileArg?.replace("--file=", ""),
    url: edition.downloadUrl,
  });

  const contactMap = buildContactMap(aptConText);
  const rows = parseCsvRows(aptBaseText);

  const records = rows
    .map((row) => mapNasrCsvRecord(row, contactMap.get(row.SITE_NO?.trim()), dataset))
    .filter((record) => {
      if (!record) return false;
      const { code, name, city, latitude, longitude } = record;
      return Boolean(code && name && city && latitude !== null && longitude !== null);
    });

  if (records.length === 0) {
    throw new Error("No valid FAA CSV airport rows were parsed.");
  }

  const initialNextSyncAt = chooseNextPoiSyncAt({
    airportCount: records.length,
    desiredCycleDays: 30,
  });

  let imported = 0;
  let failed = 0;

  for (const airport of records) {
    if (dryRun) {
      console.log(`[dry-run] would import FAA airport ${airport.code}`);
      continue;
    }

    // Import resiliently: a single problematic record must not abort the run
    try {
      await upsertFaaAirportWithLocation(prisma, airport, initialNextSyncAt);
      imported += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `failed to import FAA airport ${airport.code}: ${error?.message ?? error}`
      );
    }
  }

  if (!dryRun) {
    console.log(
      `FAA import complete: ${imported} imported, ${failed} failed of ${records.length} records.`
    );
    if (failed > 0) {
      process.exitCode = 1;
    }
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

async function loadCsvTexts({ filePath, url }) {
  if (filePath) {
    const resolvedPath = resolve(process.cwd(), filePath);

    if (filePath.toLowerCase().endsWith(".zip")) {
      const fileBuffer = await readFile(resolvedPath);
      const archiveBuffer = new Uint8Array(fileBuffer);
      const aptBaseText = await loadAptTextFromZipBytes(archiveBuffer, "APT_BASE.csv");
      const aptConText = await loadAptTextFromZipBytes(archiveBuffer, "APT_CON.csv");
      return { aptBaseText, aptConText };
    }

    if (filePath.toLowerCase().endsWith("apt_base.csv")) {
      // Expect APT_CON.csv alongside APT_BASE.csv
      const aptBaseText = (await readFile(resolvedPath)).toString("utf8");
      const aptConPath = resolvedPath.replace(/APT_BASE\.csv$/i, "APT_CON.csv");
      const aptConText = (await readFile(aptConPath)).toString("utf8");
      return { aptBaseText, aptConText };
    }

    // Assume it's a raw APT_BASE.csv; load APT_CON.csv from same dir
    const aptBaseText = (await readFile(resolvedPath)).toString("utf8");
    const aptConPath = resolvedPath.replace(/[^/\\]+$/, "APT_CON.csv");
    let aptConText = "";
    try {
      aptConText = (await readFile(aptConPath)).toString("utf8");
    } catch {
      console.warn("APT_CON.csv not found alongside APT_BASE.csv; contact data will be empty.");
    }
    return { aptBaseText, aptConText };
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`FAA airport import failed: ${response.status} ${response.statusText}`);
  }

  const archiveBuffer = new Uint8Array(await response.arrayBuffer());
  const aptBaseText = await loadAptTextFromZipBytes(archiveBuffer, "APT_BASE.csv");
  const aptConText = await loadAptTextFromZipBytes(archiveBuffer, "APT_CON.csv");
  return { aptBaseText, aptConText };
}
