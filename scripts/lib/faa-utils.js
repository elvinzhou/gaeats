// NASR discovery and APT.TXT parsing are adapted from aeroinfo:
// https://github.com/kdknigga/aeroinfo/blob/master/aeroinfo/download_nasr.py
// https://github.com/kdknigga/aeroinfo/blob/master/aeroinfo/parsers/apt.py

const FAA_NASR_DISCOVERY_URL = "https://external-api.faa.gov/apra/nfdc/nasr/chart";

export async function getCurrentNasrEdition(fetchImpl = fetch) {
  const url = new URL(FAA_NASR_DISCOVERY_URL);
  url.searchParams.set("edition", "current");

  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`FAA NASR discovery failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
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

export async function loadAptTextFromZipBytes(archiveBuffer, targetName = "apt.txt") {
  let offset = 0;

  while (offset + 30 <= archiveBuffer.length) {
    const signature = readUint32(archiveBuffer, offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) {
      break;
    }

    if (signature !== 0x04034b50) {
      throw new Error("FAA archive contains an unsupported ZIP structure.");
    }

    const flags = readUint16(archiveBuffer, offset + 6);
    const compressionMethod = readUint16(archiveBuffer, offset + 8);
    const compressedSize = readUint32(archiveBuffer, offset + 18);
    const fileNameLength = readUint16(archiveBuffer, offset + 26);
    const extraFieldLength = readUint16(archiveBuffer, offset + 28);
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const fileName = decodeText(archiveBuffer.subarray(fileNameStart, fileNameEnd));
    const dataStart = fileNameEnd + extraFieldLength;
    const dataEnd = dataStart + compressedSize;

    if ((flags & 0x0008) !== 0) {
      throw new Error("FAA archive uses ZIP data descriptors, which are not supported.");
    }

    if (fileName.toLowerCase().endsWith(targetName)) {
      const fileBytes = archiveBuffer.slice(dataStart, dataEnd);

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

export function mapNasrAptRecord(line, sourceDataset = null) {
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
    source: "FAA",
    sourceDataset,
    sourceRecordUpdatedAt,
  };
}

export function parseNasrCoordinate(value) {
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

export function parseNasrDate(value) {
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

function extractField(line, start, length) {
  return line.slice(start - 1, start - 1 + length).trim();
}

function normalizeCode(value) {
  if (!value) {
    return null;
  }

  return value.toUpperCase();
}

function normalizeEditionDate(value) {
  const [month, day, year] = value.split("/");
  if (!month || !day || !year) {
    throw new Error(`Unexpected FAA edition date format: ${value}`);
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

async function decompressDeflateRaw(bytes) {
  const payload = new Uint8Array(bytes).buffer;
  const stream = new Response(payload).body;
  if (!stream) {
    throw new Error("Unable to read FAA ZIP payload.");
  }

  const decompressedStream = stream.pipeThrough(new DecompressionStream("deflate-raw"));
  const decompressedBuffer = await new Response(decompressedStream).arrayBuffer();
  return new Uint8Array(decompressedBuffer);
}

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function decodeText(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}
