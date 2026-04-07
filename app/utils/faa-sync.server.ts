import { createPrisma } from "~/utils/db.server";
import { upsertFaaAirportWithLocation } from "~/utils/postgis.server";

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
export async function refreshFaaAirportsIfStale(cloudflare: CloudflareContext, force = false) {
  await refreshFaaAirportsIfNeeded(createPrisma(cloudflare.env.DATABASE_URL), force);
}

/**
 * Assigns a sync priority to an airport based on its name.
 * Lower number = synced sooner. West Coast region priority is handled
 * separately in listAirportsForPoiSync; this covers per-airport importance.
 *
 * Budget: 100 airports/day × 2 requests (RESTAURANT + ATTRACTION) = 200/day
 * At $0.032/request that's ~$6.40/day, well within the $200/month free credit.
 */
function computeSyncPriority(airport: FaaAirportRecord): number {
  const name = airport.name.toUpperCase();
  if (name.includes("INTERNATIONAL")) return 10;
  if (name.includes("REGIONAL") || name.includes("EXECUTIVE") || name.includes("MUNICIPAL")) return 20;
  if (name.includes("FIELD") || name.includes("AIRPORT") || name.includes("AIRPARK")) return 50;
  return 100; // heliports, seaplane bases, small strips
}

async function refreshFaaAirportsIfNeeded(prisma: ReturnType<typeof createPrisma>, force = false) {
  const [{ lastRefreshedAt }] = await prisma.$queryRaw<Array<{ lastRefreshedAt: Date | null }>>`
    SELECT MAX("sourceRefreshedAt") AS "lastRefreshedAt"
    FROM "airports"
    WHERE source = 'FAA'::"AirportSource"
  `;

  if (!force && lastRefreshedAt) {
    const staleAfter = new Date(lastRefreshedAt);
    staleAfter.setUTCDate(staleAfter.getUTCDate() + DEFAULT_REFRESH_INTERVAL_DAYS);

    if (staleAfter.getTime() > Date.now()) {
      console.log(JSON.stringify({
        level: "info",
        message: "FAA airport sync skipped — data is fresh",
        lastRefreshedAt,
        nextRefreshAt: staleAfter,
        timestamp: new Date().toISOString(),
      }));
      return;
    }
  }

  const { dataset, downloadUrl } = await getCurrentNasrEdition();
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`FAA airport import failed: ${response.status} ${response.statusText}`);
  }

  let count = 0;
  for await (const airport of streamAptRecords(response, dataset)) {
    await upsertFaaAirportWithLocation(prisma, airport, computeSyncPriority(airport));
    count++;
  }

  if (count === 0) {
    throw new Error("No valid FAA APT airport rows were parsed.");
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

async function* streamAptRecords(response: Response, sourceDataset: string | null): AsyncGenerator<FaaAirportRecord> {
  if (!response.body) throw new Error("FAA response has no body.");

  const contentType = response.headers.get("content-type") ?? "";
  const isZip = contentType.includes("zip") || response.url.toLowerCase().endsWith(".zip");

  if (!isZip) {
    yield* streamLinesAsRecords(response.body, sourceDataset);
    return;
  }

  yield* streamZipEntryLines(response.body, "apt.txt", sourceDataset);
}

/**
 * Fully-streaming ZIP reader: parses local file headers on the fly without
 * ever buffering the whole archive. Finds targetName and yields its lines.
 *
 * ZIP local-file-header layout (all little-endian):
 *   0  4  signature 0x04034b50
 *   4  2  version needed
 *   6  2  general purpose flags
 *   8  2  compression method
 *  10  2  last mod time
 *  12  2  last mod date
 *  14  4  crc-32
 *  18  4  compressed size
 *  22  4  uncompressed size
 *  26  2  file name length (n)
 *  28  2  extra field length (m)
 *  30  n  file name
 * 30+n m  extra field
 * 30+n+m  file data (compressedSize bytes)
 */
async function* streamZipEntryLines(
  body: ReadableStream<Uint8Array>,
  targetName: string,
  sourceDataset: string | null
): AsyncGenerator<FaaAirportRecord> {
  const sr = new StreamReader(body);

  while (true) {
    const sigBytes = await sr.peek(4);
    if (sigBytes.length < 4) break;

    const sig = readUint32(sigBytes, 0);
    if (sig === 0x02014b50 || sig === 0x06054b50) break; // central directory reached

    if (sig !== 0x04034b50) {
      throw new Error("FAA archive contains an unsupported ZIP structure.");
    }

    const header = await sr.readExact(30);
    const flags            = readUint16(header, 6);
    const compressionMethod = readUint16(header, 8);
    const compressedSize   = readUint32(header, 18);
    const fileNameLength   = readUint16(header, 26);
    const extraFieldLength = readUint16(header, 28);

    if ((flags & 0x0008) !== 0) {
      throw new Error("FAA archive uses ZIP data descriptors, which are not supported.");
    }

    const fileNameBytes = await sr.readExact(fileNameLength);
    const fileName = new TextDecoder().decode(fileNameBytes);
    await sr.skip(extraFieldLength);

    if (fileName.toLowerCase().endsWith(targetName)) {
      let dataStream: ReadableStream<Uint8Array>;

      if (compressionMethod === 0) {
        dataStream = sr.takeBytesAsStream(compressedSize);
      } else if (compressionMethod === 8) {
        dataStream = sr.takeBytesAsStream(compressedSize)
          .pipeThrough(new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>);
      } else {
        throw new Error(`Unsupported FAA ZIP compression method: ${compressionMethod}`);
      }

      yield* streamLinesAsRecords(dataStream, sourceDataset);
      return;
    }

    await sr.skip(compressedSize);
  }

  throw new Error(`No ${targetName} file was found in the FAA archive.`);
}

/** Reads a ReadableStream<Uint8Array> chunk-by-chunk and yields parsed FAA records line by line. */
class StreamReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buf: Uint8Array = new Uint8Array(0);
  private eof = false;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  private async refill(minBytes: number): Promise<void> {
    while (this.buf.length < minBytes && !this.eof) {
      const { value, done } = await this.reader.read();
      if (done) {
        this.eof = true;
      } else if (value?.length) {
        const merged = new Uint8Array(this.buf.length + value.length);
        merged.set(this.buf);
        merged.set(value, this.buf.length);
        this.buf = merged;
      }
    }
  }

  async peek(n: number): Promise<Uint8Array> {
    await this.refill(n);
    return this.buf.slice(0, Math.min(n, this.buf.length));
  }

  async readExact(n: number): Promise<Uint8Array> {
    await this.refill(n);
    if (this.buf.length < n) throw new Error(`Unexpected EOF: wanted ${n} bytes, got ${this.buf.length}`);
    const result = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return result;
  }

  async skip(n: number): Promise<void> {
    let remaining = n;
    if (this.buf.length > 0) {
      const take = Math.min(remaining, this.buf.length);
      this.buf = this.buf.slice(take);
      remaining -= take;
    }
    while (remaining > 0 && !this.eof) {
      const { value, done } = await this.reader.read();
      if (done) { this.eof = true; break; }
      if (value) {
        if (value.length <= remaining) {
          remaining -= value.length;
        } else {
          this.buf = value.slice(remaining);
          remaining = 0;
        }
      }
    }
  }

  /** Returns a ReadableStream that yields exactly byteCount bytes from this reader. */
  takeBytesAsStream(byteCount: number): ReadableStream<Uint8Array> {
    let remaining = byteCount;
    const self = this;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (remaining === 0) { controller.close(); return; }
        await self.refill(1);
        if (self.buf.length === 0) { controller.close(); return; }
        const take = Math.min(remaining, self.buf.length);
        controller.enqueue(self.buf.slice(0, take));
        self.buf = self.buf.slice(take);
        remaining -= take;
        if (remaining === 0) controller.close();
      },
    });
  }
}

async function* streamLinesAsRecords(
  stream: ReadableStream<Uint8Array>,
  sourceDataset: string | null
): AsyncGenerator<FaaAirportRecord> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let tail = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      if (tail) {
        const record = mapNasrAptRecord(tail, sourceDataset);
        if (record) yield record;
      }
      break;
    }

    const chunk = tail + decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");
    tail = lines.pop()!; // last partial line carried forward

    for (const line of lines) {
      const record = mapNasrAptRecord(line.trimEnd(), sourceDataset);
      if (record) yield record;
    }
  }
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
