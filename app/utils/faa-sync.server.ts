import { createPrisma } from "~/utils/db.server";
import { upsertFaaAirportWithLocation } from "~/utils/postgis.server";
import { chooseNextPoiSyncAt } from "~/utils/sync-utils.server";

type CloudflareContext = {
  env: Env;
  ctx: ExecutionContext;
};

type FaaAirportRecord = {
  code: string;
  faaCode: string | null;
  icaoCode: string | null;
  name: string;
  city: string;
  state: string | null;
  country: string;
  latitude: number;
  longitude: number;
  sourceDataset: string | null;
  sourceRecordUpdatedAt: Date | null;
};

type NasrEditionResponse = {
  edition?: Array<{
    editionDate?: string;
    product?: {
      url?: string;
    };
  }>;
};

// NASR discovery and APT.TXT parsing are adapted from aeroinfo:
// https://github.com/kdknigga/aeroinfo/blob/master/aeroinfo/download_nasr.py
// https://github.com/kdknigga/aeroinfo/blob/master/aeroinfo/parsers/apt.py
const FAA_NASR_DISCOVERY_URL = "https://external-api.faa.gov/apra/nfdc/nasr/chart";
const DEFAULT_REFRESH_INTERVAL_DAYS = 28;
export async function refreshFaaAirportsIfStale(cloudflare: CloudflareContext) {
  await refreshFaaAirportsIfNeeded(createPrisma(cloudflare.env.DATABASE_URL));
}

async function refreshFaaAirportsIfNeeded(prisma: ReturnType<typeof createPrisma>) {
  const [{ lastRefreshedAt }] = await prisma.$queryRaw<Array<{ lastRefreshedAt: Date | null }>>`
    SELECT MAX("sourceRefreshedAt") AS "lastRefreshedAt"
    FROM "airports"
    WHERE source = 'FAA'::"AirportSource"
  `;

  if (lastRefreshedAt) {
    const staleAfter = new Date(lastRefreshedAt);
    staleAfter.setUTCDate(staleAfter.getUTCDate() + DEFAULT_REFRESH_INTERVAL_DAYS);

    if (staleAfter.getTime() > Date.now()) {
      return;
    }
  }

  const { dataset, downloadUrl } = await getCurrentNasrEdition();
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`FAA airport import failed: ${response.status} ${response.statusText}`);
  }

  const aptText = await loadAptText(response);
  const records = aptText
    .split(/\r?\n/)
    .map((line) => mapNasrAptRecord(line, dataset))
    .filter((record): record is FaaAirportRecord => record !== null);

  if (records.length === 0) {
    throw new Error("No valid FAA APT airport rows were parsed.");
  }

  const nextPoiSyncAt = chooseNextPoiSyncAt({
    airportCount: records.length,
    desiredCycleDays: 30,
  });

  for (const airport of records) {
    await upsertFaaAirportWithLocation(prisma, airport, nextPoiSyncAt);
  }
}

async function getCurrentNasrEdition() {
  const url = new URL(FAA_NASR_DISCOVERY_URL);
  url.searchParams.set("edition", "current");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`FAA NASR discovery failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as NasrEditionResponse;
  const edition = payload.edition?.[0];
  const downloadUrl = edition?.product?.url;
  const editionDate = edition?.editionDate;

  if (!downloadUrl || !editionDate) {
    throw new Error("FAA NASR discovery response did not include a download URL and edition date.");
  }

  return {
    downloadUrl,
    dataset: `faa-nasr-${normalizeEditionDate(editionDate)}-apt`,
  };
}

async function loadAptText(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("zip") && !response.url.toLowerCase().endsWith(".zip")) {
    return response.text();
  }

  const archiveBuffer = await response.arrayBuffer();
  return extractTextFileFromZip(new Uint8Array(archiveBuffer), "apt.txt");
}

async function extractTextFileFromZip(archive: Uint8Array, targetName: string) {
  let offset = 0;

  while (offset + 30 <= archive.length) {
    const signature = readUint32(archive, offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) {
      break;
    }

    if (signature !== 0x04034b50) {
      throw new Error("FAA archive contains an unsupported ZIP structure.");
    }

    const flags = readUint16(archive, offset + 6);
    const compressionMethod = readUint16(archive, offset + 8);
    const compressedSize = readUint32(archive, offset + 18);
    const fileNameLength = readUint16(archive, offset + 26);
    const extraFieldLength = readUint16(archive, offset + 28);
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const fileName = decodeText(archive.subarray(fileNameStart, fileNameEnd));
    const dataStart = fileNameEnd + extraFieldLength;
    const dataEnd = dataStart + compressedSize;

    if ((flags & 0x0008) !== 0) {
      throw new Error("FAA archive uses ZIP data descriptors, which are not supported.");
    }

    if (fileName.toLowerCase().endsWith(targetName)) {
      const fileBytes = archive.slice(dataStart, dataEnd);

      if (compressionMethod === 0) {
        return decodeText(fileBytes);
      }

      if (compressionMethod === 8) {
        const decompressed = await decompressDeflateRaw(fileBytes);
        return decodeText(decompressed);
      }

      throw new Error(`Unsupported FAA ZIP compression method: ${compressionMethod}`);
    }

    offset = dataEnd;
  }

  throw new Error(`No ${targetName} file was found in the FAA archive.`);
}

async function decompressDeflateRaw(bytes: Uint8Array) {
  const payload = new Uint8Array(bytes).buffer;
  const stream = new Response(payload).body;
  if (!stream) {
    throw new Error("Unable to read FAA ZIP payload.");
  }

  const decompressedStream = stream.pipeThrough(new DecompressionStream("deflate-raw"));
  const decompressedBuffer = await new Response(decompressedStream).arrayBuffer();
  return new Uint8Array(decompressedBuffer);
}

function readUint16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function decodeText(bytes: Uint8Array) {
  return new TextDecoder("utf-8").decode(bytes);
}

function mapNasrAptRecord(line: string, sourceDataset: string | null) {
  if (extractField(line, 1, 3) !== "APT") {
    return null;
  }

  const faaCode = normalizeCode(extractField(line, 28, 4));
  const icaoCode = normalizeCode(extractField(line, 1211, 7));
  const code = icaoCode || faaCode;
  const name = extractField(line, 134, 50);
  const city = extractField(line, 94, 40);
  const state = extractField(line, 49, 2) || null;
  const latitude = parseNasrCoordinate(extractField(line, 524, 15));
  const longitude = parseNasrCoordinate(extractField(line, 551, 15));

  if (!code || !name || !city || latitude === null || longitude === null) {
    return null;
  }

  const sourceRecordUpdatedAt =
    parseNasrDate(extractField(line, 885, 8)) ??
    parseNasrDate(extractField(line, 32, 10)) ??
    parseNasrDate(extractField(line, 834, 7));

  return {
    code,
    faaCode,
    icaoCode,
    name,
    city,
    state,
    country: "US",
    latitude,
    longitude,
    sourceDataset,
    sourceRecordUpdatedAt,
  } satisfies FaaAirportRecord;
}

function extractField(line: string, start: number, length: number) {
  return line.slice(start - 1, start - 1 + length).trim();
}

function normalizeCode(value: string) {
  if (!value) {
    return null;
  }

  return value.toUpperCase();
}

function parseNasrCoordinate(value: string) {
  const compact = value.replaceAll(/\s+/g, "");
  if (!compact) {
    return null;
  }

  const direction = compact.slice(-1).toUpperCase();
  const numeric = compact.slice(0, -1);
  const degreeDigits = direction === "N" || direction === "S" ? 2 : 3;

  if (!/^[NSEW]$/.test(direction) || numeric.length < degreeDigits + 4) {
    return null;
  }

  const degrees = Number.parseFloat(numeric.slice(0, degreeDigits));
  const minutes = Number.parseFloat(numeric.slice(degreeDigits, degreeDigits + 2));
  const seconds = Number.parseFloat(numeric.slice(degreeDigits + 2));

  if ([degrees, minutes, seconds].some((part) => Number.isNaN(part))) {
    return null;
  }

  let decimal = degrees + minutes / 60 + seconds / 3600;
  if (direction === "S" || direction === "W") {
    decimal *= -1;
  }

  return decimal;
}

function parseNasrDate(value: string) {
  if (!value) {
    return null;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    const [month, day, year] = value.split("/");
    return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  }

  if (/^\d{8}$/.test(value)) {
    const month = value.slice(0, 2);
    const day = value.slice(2, 4);
    const year = value.slice(4, 8);
    return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }

  return null;
}

function normalizeEditionDate(value: string) {
  const [month, day, year] = value.split("/");
  if (!month || !day || !year) {
    throw new Error(`Unexpected FAA edition date format: ${value}`);
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
