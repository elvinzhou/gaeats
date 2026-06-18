// NASR discovery and APT.TXT parsing are adapted from aeroinfo:
// https://github.com/kdknigga/aeroinfo/blob/master/aeroinfo/download_nasr.py
// https://github.com/kdknigga/aeroinfo/blob/master/aeroinfo/parsers/apt.py

const FAA_NASR_DISCOVERY_URL = "https://external-api.faa.gov/apra/nfdc/nasr/chart";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

// Derives the CSV zip URL from an FAA edition date string "MM/DD/YYYY"
export function csvEditionUrl(editionDate) {
  const [month, day, year] = editionDate.split("/");
  if (!month || !day || !year) {
    throw new Error(`Unexpected FAA edition date format: ${editionDate}`);
  }
  const monthIndex = Number.parseInt(month, 10) - 1;
  const monthName = MONTH_ABBR[monthIndex];
  if (!monthName) {
    throw new Error(`Invalid month in FAA edition date: ${editionDate}`);
  }
  const dayPadded = day.padStart(2, "0");
  return `https://nfdc.faa.gov/webContent/28DaySub/extra/${dayPadded}_${monthName}_${year}_CSV.zip`;
}

// Calls FAA API, returns { downloadUrl (CSV URL), dataset }
export async function getCurrentNasrCsvEdition(fetchImpl = fetch) {
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
  const editionDate = edition?.editionDate;

  if (!editionDate) {
    throw new Error("FAA NASR discovery response did not include an edition date.");
  }

  const downloadUrl = csvEditionUrl(editionDate);
  const dataset = `faa-nasr-${normalizeEditionDate(editionDate)}-apt`;

  return { downloadUrl, dataset };
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

    if (fileName.toLowerCase().endsWith(targetName.toLowerCase())) {
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

// Parses CSV text into array of plain objects with string values.
// Handles quoted fields (including embedded commas and escaped quotes per RFC 4180).
export function parseCsvRows(csvText) {
  const lines = csvText.split(/\r?\n/);
  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }
    const values = parseCsvLine(line);
    const row = {};
    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = values[j] ?? "";
    }
    rows.push(row);
  }

  return rows;
}

function parseCsvLine(line) {
  const fields = [];
  let pos = 0;

  while (pos <= line.length) {
    if (pos === line.length) {
      // Trailing comma: already handled by the comma-skip below producing an empty field
      break;
    }

    if (line[pos] === '"') {
      // Quoted field
      pos += 1; // skip opening quote
      let field = "";
      while (pos < line.length) {
        if (line[pos] === '"') {
          if (pos + 1 < line.length && line[pos + 1] === '"') {
            // Escaped quote ""
            field += '"';
            pos += 2;
          } else {
            // End of quoted field
            pos += 1;
            break;
          }
        } else {
          field += line[pos];
          pos += 1;
        }
      }
      fields.push(field);
      // Skip delimiter or end
      if (pos < line.length && line[pos] === ",") {
        pos += 1;
      }
    } else {
      // Unquoted field: read until comma or end
      const start = pos;
      while (pos < line.length && line[pos] !== ",") {
        pos += 1;
      }
      fields.push(line.slice(start, pos));
      if (pos < line.length) {
        pos += 1; // skip comma
      } else {
        break;
      }
    }
  }

  return fields;
}

// Builds a lookup Map<SITE_NO, { ownerName, ownerPhone, managerName, managerPhone }>
// from APT_CON.csv content
export function buildContactMap(aptConText) {
  const rows = parseCsvRows(aptConText);
  const map = new Map();

  for (const row of rows) {
    const siteNo = row.SITE_NO?.trim();
    if (!siteNo) {
      continue;
    }

    const title = row.TITLE?.trim().toUpperCase();
    const name = row.NAME?.trim() || null;
    const phone = row.PHONE_NO?.trim() || null;

    if (!map.has(siteNo)) {
      map.set(siteNo, { ownerName: null, ownerPhone: null, managerName: null, managerPhone: null });
    }

    const contact = map.get(siteNo);

    if (title === "OWNER") {
      contact.ownerName = name;
      contact.ownerPhone = phone;
    } else if (title === "MANAGER") {
      contact.managerName = name;
      contact.managerPhone = phone;
    }
  }

  return map;
}

const VALID_OWNERSHIP_TYPES = new Set(["PU", "PR", "MA", "MR", "MN", "MK", "CG"]);
const VALID_AIRPORT_USE = new Set(["PU", "PR"]);
const SITE_TYPE_NAMES = { A: "AIRPORT", H: "HELIPORT", B: "BALLOON PORT", C: "SEAPLANE BASE", G: "GLIDERPORT", U: "ULTRALIGHT" };

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

// Maps one APT_BASE CSV row object + contact record to our canonical airport payload.
// contacts = { ownerName, ownerPhone, managerName, managerPhone } | null
export function mapNasrCsvRecord(row, contacts, sourceDataset = null) {
  if (row.COUNTRY_CODE?.trim() !== "US") {
    return null;
  }

  const latDecimal = Number.parseFloat(row.LAT_DECIMAL);
  const longDecimal = Number.parseFloat(row.LONG_DECIMAL);

  if (!Number.isFinite(latDecimal) || !Number.isFinite(longDecimal)) {
    return null;
  }

  // Apply hemisphere sign
  const latitude = row.LAT_HEMIS?.trim() === "S" ? -Math.abs(latDecimal) : Math.abs(latDecimal);
  const longitude = row.LONG_HEMIS?.trim() === "W" ? -Math.abs(longDecimal) : Math.abs(longDecimal);

  const faaCode = row.ARPT_ID?.trim() || null;
  const icaoCode = row.ICAO_ID?.trim() || null;
  const code = icaoCode || faaCode;

  const name = row.ARPT_NAME?.trim() || null;
  const city = row.CITY?.trim() || null;

  if (!code || !name || !city) {
    return null;
  }

  const state = row.STATE_CODE?.trim() || null;

  const siteTypeCode = row.SITE_TYPE_CODE?.trim();
  const facilityType = SITE_TYPE_NAMES[siteTypeCode] ?? null;

  const ownershipTypeRaw = row.OWNERSHIP_TYPE_CODE?.trim();
  const ownershipType = VALID_OWNERSHIP_TYPES.has(ownershipTypeRaw) ? ownershipTypeRaw : null;

  const airportUseRaw = row.FACILITY_USE_CODE?.trim();
  const airportUse = VALID_AIRPORT_USE.has(airportUseRaw) ? airportUseRaw : null;

  const elevationRaw = Number.parseFloat(row.ELEV);
  const elevation = Number.isNaN(elevationRaw) || elevationRaw < -1500 || elevationRaw > 25000 ? null : elevationRaw;

  const magVarn = row.MAG_VARN?.trim() || "";
  const magHemis = row.MAG_HEMIS?.trim() || "";
  const magVariation = magVarn && magHemis ? `${magVarn}${magHemis}` : (magVarn || null);

  const magVariationYear = row.MAG_VARN_YEAR?.trim() || null;

  const tpaRaw = Number.parseInt(row.TPA?.trim(), 10);
  const trafficPatternAltitude = Number.isNaN(tpaRaw) ? null : tpaRaw;

  const distCityRaw = Number.parseInt(row.DIST_CITY_TO_AIRPORT?.trim(), 10);
  const distanceFromCity = Number.isNaN(distCityRaw) ? null : distCityRaw;

  const acreageRaw = Number.parseInt(row.ACREAGE?.trim(), 10);
  const acreage = Number.isNaN(acreageRaw) ? null : acreageRaw;

  const arffCertRaw = row.FAR_139_TYPE_CODE?.trim() || null;

  const hgrFlag = row.TRNS_STRG_HGR_FLAG?.trim() === "Y";
  const tieFlag = row.TRNS_STRG_TIE_FLAG?.trim() === "Y";
  const buoyFlag = row.TRNS_STRG_BUOY_FLAG?.trim() === "Y";

  const storageParts = [];
  if (hgrFlag) storageParts.push("HGR");
  if (tieFlag) storageParts.push("TIE");
  if (buoyFlag) storageParts.push("BUOY");
  const storageFacilities = storageParts.length > 0 ? storageParts.join(" ") : null;

  const sourceRecordUpdatedAt = parseNasrDate(row.EFF_DATE);

  return {
    code,
    faaCode,
    icaoCode,
    facilityType,
    ownershipType,
    airportUse,
    elevation,
    // Demographic / administrative
    siteNumber: row.SITE_NO?.trim() || null,
    faaRegionCode: row.REGION_CODE?.trim() || null,
    stateName: row.STATE_NAME?.trim() || null,
    countyName: row.COUNTY_NAME?.trim() || null,
    countyState: row.COUNTY_ASSOC_STATE?.trim() || null,
    // Ownership / management (from APT_CON)
    ownerName: contacts?.ownerName ?? null,
    ownerPhone: contacts?.ownerPhone ?? null,
    managerName: contacts?.managerName ?? null,
    managerPhone: contacts?.managerPhone ?? null,
    // Geographic
    magVariation,
    magVariationYear,
    trafficPatternAltitude,
    sectionalChart: row.CHART_NAME?.trim() || null,
    distanceFromCity,
    directionFromCity: row.DIRECTION_CODE?.trim() || null,
    acreage,
    // FAA services
    artccBoundaryId: null,
    artccResponsibleId: row.RESP_ARTCC_ID?.trim() || null,
    notamFacility: row.NOTAM_ID?.trim() || null,
    notamDService: row.NOTAM_FLAG?.trim() || null,
    // Federal status
    activationDate: row.ACTIVATION_DATE?.trim() || null,
    airportStatus: row.ARPT_STATUS?.trim() || null,
    arffCertification: arffCertRaw || null,
    npiasAgreements: row.NASP_CODE?.trim() || null,
    airspaceAnalysis: row.ASP_ANLYS_DTRM_CODE?.trim() || null,
    customsEntry: row.CUST_FLAG?.trim() || null,
    customsLanding: row.LNDG_RIGHTS_FLAG?.trim() || null,
    jointUse: row.JOINT_USE_FLAG?.trim() || null,
    militaryRights: row.MIL_LNDG_FLAG?.trim() || null,
    // Airport services
    fuelTypes: row.FUEL_TYPES?.trim() || null,
    airframeRepair: row.AIRFRAME_REPAIR_SER_CODE?.trim() || null,
    engineRepair: row.PWR_PLANT_REPAIR_SER?.trim() || null,
    bottledOxygen: row.BOTTLED_OXY_TYPE?.trim() || null,
    bulkOxygen: row.BULK_OXY_TYPE?.trim() || null,
    // Airport facilities
    lightingSchedule: row.LGT_SKED?.trim() || null,
    beaconSchedule: row.BCN_LGT_SKED?.trim() || null,
    controlTower: row.TWR_TYPE_CODE?.trim() || null,
    unicomFrequency: null,
    ctafFrequency: null,
    segmentedCircle: row.SEG_CIRCLE_MKR_FLAG?.trim() || null,
    beaconColor: row.BCN_LENS_COLOR?.trim() || null,
    landingFee: row.LNDG_FEE_FLAG?.trim() || null,
    // Based aircraft counts — not in CSV
    singleEngineCount: null,
    multiEngineCount: null,
    jetEngineCount: null,
    helicopterCount: null,
    gliderCount: null,
    militaryCount: null,
    ultralightCount: null,
    // Annual operations — not in CSV
    annualCommercialOps: null,
    annualCommuterOps: null,
    annualAirTaxiOps: null,
    annualGaLocalOps: null,
    annualGaItinerantOps: null,
    annualMilitaryOps: null,
    annualOpsDate: null,
    // Additional
    contractFuel: row.CONTR_FUEL_AVBL?.trim() || null,
    storageFacilities,
    otherServices: row.OTHER_SERVICES?.trim() || null,
    windIndicator: row.WIND_INDCR_FLAG?.trim() || null,
    minOperationalNetwork: row.MIN_OP_NETWORK?.trim() || null,
    // Transient storage booleans
    transientStorageHangar: hgrFlag,
    transientStorageTiedown: tieFlag,
    transientStorageBuoy: buoyFlag,
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
