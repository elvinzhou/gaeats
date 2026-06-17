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

const VALID_OWNERSHIP_TYPES = new Set(["PU", "PR", "MA", "MR", "MN", "MK", "CG"]);
const VALID_AIRPORT_USE = new Set(["PU", "PR"]);

export function mapNasrAptRecord(line, sourceDataset = null) {
  if (extractField(line, 1, 3) !== "APT") {
    return null;
  }

  const faaCode = normalizeCode(extractField(line, 28, 4));
  const icaoCode = normalizeCode(extractField(line, 1211, 7));
  const code = icaoCode || faaCode;
  const facilityType = extractField(line, 14, 13) || null;
  const ownershipTypeRaw = extractField(line, 184, 2);
  const ownershipType = VALID_OWNERSHIP_TYPES.has(ownershipTypeRaw) ? ownershipTypeRaw : null;
  const airportUseRaw = extractField(line, 186, 2);
  const airportUse = VALID_AIRPORT_USE.has(airportUseRaw) ? airportUseRaw : null;
  const elevationRaw = Number.parseFloat(extractField(line, 579, 7));
  const elevation = Number.isNaN(elevationRaw) || elevationRaw < -1500 || elevationRaw > 25000 ? null : elevationRaw;
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
    facilityType,
    ownershipType,
    airportUse,
    elevation,
    // Demographic / administrative
    siteNumber: extractField(line, 4, 11) || null,
    faaRegionCode: extractField(line, 42, 3) || null,
    stateName: extractField(line, 51, 20) || null,
    countyName: extractField(line, 71, 21) || null,
    countyState: extractField(line, 92, 2) || null,
    // Ownership / management
    ownerName: extractField(line, 188, 35) || null,
    ownerPhone: extractField(line, 340, 16) || null,
    managerName: extractField(line, 356, 35) || null,
    managerPhone: extractField(line, 508, 16) || null,
    // Geographic
    magVariation: extractField(line, 587, 3) || null,
    magVariationYear: extractField(line, 590, 4) || null,
    trafficPatternAltitude: extractInt(line, 594, 4),
    sectionalChart: extractField(line, 598, 30) || null,
    distanceFromCity: extractInt(line, 628, 2),
    directionFromCity: extractField(line, 630, 3) || null,
    acreage: extractInt(line, 633, 5),
    // FAA services
    artccBoundaryId: extractField(line, 638, 4) || null,
    artccResponsibleId: extractField(line, 675, 4) || null,
    notamFacility: extractField(line, 829, 4) || null,
    notamDService: extractField(line, 833, 1) || null,
    // Federal status
    activationDate: extractField(line, 834, 7) || null,
    airportStatus: extractField(line, 841, 2) || null,
    arffCertification: extractField(line, 843, 15) || null,
    npiasAgreements: extractField(line, 858, 7) || null,
    airspaceAnalysis: extractField(line, 865, 13) || null,
    customsEntry: extractField(line, 878, 1) || null,
    customsLanding: extractField(line, 879, 1) || null,
    jointUse: extractField(line, 880, 1) || null,
    militaryRights: extractField(line, 881, 1) || null,
    // Airport services
    fuelTypes: extractField(line, 901, 40) || null,
    airframeRepair: extractField(line, 941, 5) || null,
    engineRepair: extractField(line, 946, 5) || null,
    bottledOxygen: extractField(line, 951, 8) || null,
    bulkOxygen: extractField(line, 959, 8) || null,
    // Airport facilities
    lightingSchedule: extractField(line, 967, 7) || null,
    beaconSchedule: extractField(line, 974, 7) || null,
    controlTower: extractField(line, 981, 1) || null,
    unicomFrequency: extractField(line, 982, 7) || null,
    ctafFrequency: extractField(line, 989, 7) || null,
    segmentedCircle: extractField(line, 996, 4) || null,
    beaconColor: extractField(line, 1000, 3) || null,
    landingFee: extractField(line, 1003, 1) || null,
    // Based aircraft counts
    singleEngineCount: extractInt(line, 1005, 3),
    multiEngineCount: extractInt(line, 1008, 3),
    jetEngineCount: extractInt(line, 1011, 3),
    helicopterCount: extractInt(line, 1014, 3),
    gliderCount: extractInt(line, 1017, 3),
    militaryCount: extractInt(line, 1020, 3),
    ultralightCount: extractInt(line, 1023, 3),
    // Annual operations
    annualCommercialOps: extractInt(line, 1026, 6),
    annualCommuterOps: extractInt(line, 1032, 6),
    annualAirTaxiOps: extractInt(line, 1038, 6),
    annualGaLocalOps: extractInt(line, 1044, 6),
    annualGaItinerantOps: extractInt(line, 1050, 6),
    annualMilitaryOps: extractInt(line, 1056, 6),
    annualOpsDate: extractField(line, 1062, 10) || null,
    // Additional
    contractFuel: extractField(line, 1124, 1) || null,
    storageFacilities: extractField(line, 1125, 12) || null,
    otherServices: extractField(line, 1137, 71) || null,
    windIndicator: extractField(line, 1208, 3) || null,
    minOperationalNetwork: extractField(line, 1218, 1) || null,
    // Core fields
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
  if (!/^[NSEW]$/.test(direction)) {
    return null;
  }

  const body = compact.slice(0, -1);
  const degreeDigits = direction === "N" || direction === "S" ? 2 : 3;

  let degrees;
  let minutes;
  let seconds;

  if (body.includes("-")) {
    // FAA NASR "formatted" DMS uses dash separators, e.g. "37-46-28.0000N"
    // or "122-06-54.0000W". Splitting on "-" is required — treating it as a
    // packed DDMMSS string mis-reads the dashes as part of the numbers and
    // corrupts every coordinate (minutes/seconds collapse toward zero, which
    // clusters airports near whole-degree lines and shifts them off-location).
    const parts = body.split("-");
    if (parts.length !== 3) {
      return null;
    }
    [degrees, minutes, seconds] = parts.map((part) => Number.parseFloat(part));
  } else {
    // Packed form without separators, e.g. "374628.00N" / "1220654.00W".
    if (body.length < degreeDigits + 4) {
      return null;
    }
    degrees = Number.parseFloat(body.slice(0, degreeDigits));
    minutes = Number.parseFloat(body.slice(degreeDigits, degreeDigits + 2));
    seconds = Number.parseFloat(body.slice(degreeDigits + 2));
  }

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

function extractInt(line, start, length) {
  const raw = Number.parseInt(extractField(line, start, length), 10);
  return Number.isNaN(raw) ? null : raw;
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
