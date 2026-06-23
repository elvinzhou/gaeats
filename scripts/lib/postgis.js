export async function listAirportsForPoiSync(prisma, airportCode) {
  if (airportCode) {
    return prisma.$queryRaw`
      SELECT
        id,
        code,
        city,
        state,
        "nextPoiSyncAt",
        "syncPriority",
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude
      FROM "airports"
      WHERE UPPER(code) = UPPER(${airportCode})
    `;
  }

  // Prioritize NorCal (Bay Area) first, then West Coast states (CA, OR, WA).
  // Skip non-AIRPORT facility types — heliports, seaplane bases, gliderports,
  // etc. have no nearby restaurants worth indexing. NULL means pre-migration
  // rows where the type was not yet recorded; include them as a safe fallback.
  // Also restrict to airports with transient storage (hangar or tie-down), or
  // those that haven't been re-imported with CSV data yet (IS NULL fallback).
  return prisma.$queryRaw`
    SELECT
      id,
      code,
      city,
      state,
      "nextPoiSyncAt",
      "syncPriority",
      ST_Y(location::geometry) as latitude,
      ST_X(location::geometry) as longitude,
      CASE
        WHEN state = 'CA' AND ST_Y(location::geometry) BETWEEN 36.5 AND 39.0 AND ST_X(location::geometry) BETWEEN -123.5 AND -121.0 THEN 1 -- NorCal/Bay Area
        WHEN state IN ('CA', 'OR', 'WA') THEN 2 -- West Coast
        ELSE 3
      END as "regionPriority"
    FROM "airports"
    WHERE ("facilityType" = 'AIRPORT' OR "facilityType" IS NULL)
      AND ("transientStorageHangar" = true OR "transientStorageTiedown" = true OR "facilityType" IS NULL)
    ORDER BY "regionPriority" ASC, "syncPriority" ASC
  `;
}

export async function listAirportsForFboSync(prisma, airportCode) {
  if (airportCode) {
    return prisma.$queryRaw`
      SELECT
        a.id,
        a.code,
        a.city,
        a.state,
        a."fboName",
        ST_Y(a.location::geometry) AS latitude,
        ST_X(a.location::geometry) AS longitude,
        CASE WHEN COUNT(f.id) > 0 THEN true ELSE false END AS "hasFbos"
      FROM "airports" a
      LEFT JOIN "airport_fbos" f ON f."airportId" = a.id
      WHERE UPPER(a.code) = UPPER(${airportCode})
      GROUP BY a.id, a.code, a.city, a.state, a."fboName", a.location
    `;
  }

  return prisma.$queryRaw`
    SELECT
      a.id,
      a.code,
      a.city,
      a.state,
      a."fboName",
      ST_Y(a.location::geometry) AS latitude,
      ST_X(a.location::geometry) AS longitude,
      CASE WHEN COUNT(f.id) > 0 THEN true ELSE false END AS "hasFbos"
    FROM "airports" a
    LEFT JOIN "airport_fbos" f ON f."airportId" = a.id
    WHERE (a."facilityType" = 'AIRPORT' OR a."facilityType" IS NULL)
      AND (a."transientStorageHangar" = true OR a."transientStorageTiedown" = true OR a."facilityType" IS NULL)
      AND a.country = 'US'
    GROUP BY a.id, a.code, a.city, a.state, a."fboName", a.location
    ORDER BY "hasFbos" ASC, a.code ASC
  `;
}

/**
 * Verified FBO records (name + real coordinates) for one airport, sourced from
 * the OSM/Google FBO sync. Used to ground transient-ramp coordinate resolution.
 */
export async function listAirportFbos(prisma, airportId) {
  return prisma.$queryRaw`
    SELECT name, latitude, longitude, source
    FROM "airport_fbos"
    WHERE "airportId" = ${airportId}
    ORDER BY name ASC
  `;
}

export async function upsertAirportFbo(prisma, { airportId, name, placeId, latitude, longitude, source }) {
  await prisma.$executeRaw`
    INSERT INTO "airport_fbos" ("airportId", name, "placeId", latitude, longitude, source, "createdAt", "updatedAt")
    VALUES (${airportId}, ${name}, ${placeId ?? null}, ${latitude}, ${longitude}, ${source}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("airportId", name) DO UPDATE SET
      "placeId"   = COALESCE(EXCLUDED."placeId", "airport_fbos"."placeId"),
      latitude    = EXCLUDED.latitude,
      longitude   = EXCLUDED.longitude,
      source      = EXCLUDED.source,
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}

export async function upsertGooglePoiWithLocation(prisma, data) {
  const point = `POINT(${data.longitude} ${data.latitude})`;

  const rows = await prisma.$queryRaw`
    INSERT INTO "pois" (
      source,
      "externalSourceId",
      type,
      name,
      category,
      subcategory,
      cuisine,
      description,
      address,
      city,
      state,
      country,
      "priceLevel",
      "externalRating",
      "externalReviewCount",
      url,
      phone,
      "hoursJson",
      active,
      "lastSyncedAt",
      location,
      "createdAt",
      "updatedAt"
    )
    VALUES (
      'GOOGLE_MAPS'::"ExternalSource",
      ${data.externalSourceId},
      ${data.requestedType}::"PoiType",
      ${data.name},
      ${data.category},
      ${data.subcategory},
      ${data.cuisine},
      ${data.description},
      ${data.address},
      ${data.city},
      ${data.state},
      'US',
      ${data.priceLevel},
      ${data.externalRating},
      ${data.externalReviewCount},
      ${data.url},
      ${data.phone},
      CAST(${data.hoursJson} AS JSONB),
      true,
      CURRENT_TIMESTAMP,
      ST_GeomFromText(${point}, 4326),
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (source, "externalSourceId") DO UPDATE SET
      type = EXCLUDED.type,
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      subcategory = EXCLUDED.subcategory,
      cuisine = EXCLUDED.cuisine,
      description = EXCLUDED.description,
      address = EXCLUDED.address,
      city = EXCLUDED.city,
      state = EXCLUDED.state,
      country = EXCLUDED.country,
      "priceLevel" = EXCLUDED."priceLevel",
      "externalRating" = EXCLUDED."externalRating",
      "externalReviewCount" = EXCLUDED."externalReviewCount",
      url = EXCLUDED.url,
      phone = EXCLUDED.phone,
      "hoursJson" = EXCLUDED."hoursJson",
      active = true,
      "lastSyncedAt" = CURRENT_TIMESTAMP,
      location = EXCLUDED.location,
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING id
  `;

  return rows[0]?.id ?? null;
}

export async function upsertFaaAirportWithLocation(prisma, airport, nextPoiSyncAt) {
  const point = `POINT(${airport.longitude} ${airport.latitude})`;

  // faaCode is the FAA's permanent identifier and survives code renames between
  // NASR editions. Fall back to code when faaCode is absent.
  const where = airport.faaCode ? { faaCode: airport.faaCode } : { code: airport.code };

  const scalarData = {
    code: airport.code,
    faaCode: airport.faaCode ?? null,
    icaoCode: airport.icaoCode ?? null,
    facilityType: airport.facilityType ?? null,
    ownershipType: airport.ownershipType ?? null,
    airportUse: airport.airportUse ?? null,
    elevation: airport.elevation ?? null,
    siteNumber: airport.siteNumber ?? null,
    faaRegionCode: airport.faaRegionCode ?? null,
    stateName: airport.stateName ?? null,
    countyName: airport.countyName ?? null,
    countyState: airport.countyState ?? null,
    ownerName: airport.ownerName ?? null,
    ownerPhone: airport.ownerPhone ?? null,
    managerName: airport.managerName ?? null,
    managerPhone: airport.managerPhone ?? null,
    magVariation: airport.magVariation ?? null,
    magVariationYear: airport.magVariationYear ?? null,
    trafficPatternAltitude: airport.trafficPatternAltitude ?? null,
    sectionalChart: airport.sectionalChart ?? null,
    distanceFromCity: airport.distanceFromCity ?? null,
    directionFromCity: airport.directionFromCity ?? null,
    acreage: airport.acreage ?? null,
    artccBoundaryId: airport.artccBoundaryId ?? null,
    artccResponsibleId: airport.artccResponsibleId ?? null,
    notamFacility: airport.notamFacility ?? null,
    notamDService: airport.notamDService ?? null,
    activationDate: airport.activationDate ?? null,
    airportStatus: airport.airportStatus ?? null,
    arffCertification: airport.arffCertification ?? null,
    npiasAgreements: airport.npiasAgreements ?? null,
    airspaceAnalysis: airport.airspaceAnalysis ?? null,
    customsEntry: airport.customsEntry ?? null,
    customsLanding: airport.customsLanding ?? null,
    jointUse: airport.jointUse ?? null,
    militaryRights: airport.militaryRights ?? null,
    fuelTypes: airport.fuelTypes ?? null,
    airframeRepair: airport.airframeRepair ?? null,
    engineRepair: airport.engineRepair ?? null,
    bottledOxygen: airport.bottledOxygen ?? null,
    bulkOxygen: airport.bulkOxygen ?? null,
    lightingSchedule: airport.lightingSchedule ?? null,
    beaconSchedule: airport.beaconSchedule ?? null,
    controlTower: airport.controlTower ?? null,
    unicomFrequency: airport.unicomFrequency ?? null,
    ctafFrequency: airport.ctafFrequency ?? null,
    segmentedCircle: airport.segmentedCircle ?? null,
    beaconColor: airport.beaconColor ?? null,
    landingFee: airport.landingFee ?? null,
    singleEngineCount: airport.singleEngineCount ?? null,
    multiEngineCount: airport.multiEngineCount ?? null,
    jetEngineCount: airport.jetEngineCount ?? null,
    helicopterCount: airport.helicopterCount ?? null,
    gliderCount: airport.gliderCount ?? null,
    militaryCount: airport.militaryCount ?? null,
    ultralightCount: airport.ultralightCount ?? null,
    annualCommercialOps: airport.annualCommercialOps ?? null,
    annualCommuterOps: airport.annualCommuterOps ?? null,
    annualAirTaxiOps: airport.annualAirTaxiOps ?? null,
    annualGaLocalOps: airport.annualGaLocalOps ?? null,
    annualGaItinerantOps: airport.annualGaItinerantOps ?? null,
    annualMilitaryOps: airport.annualMilitaryOps ?? null,
    annualOpsDate: airport.annualOpsDate ?? null,
    contractFuel: airport.contractFuel ?? null,
    storageFacilities: airport.storageFacilities ?? null,
    otherServices: airport.otherServices ?? null,
    windIndicator: airport.windIndicator ?? null,
    minOperationalNetwork: airport.minOperationalNetwork ?? null,
    transientStorageHangar: airport.transientStorageHangar ?? null,
    transientStorageTiedown: airport.transientStorageTiedown ?? null,
    transientStorageBuoy: airport.transientStorageBuoy ?? null,
    source: "FAA",
    sourceDataset: airport.sourceDataset ?? null,
    sourceRecordUpdatedAt: airport.sourceRecordUpdatedAt ?? null,
    sourceRefreshedAt: new Date(),
    name: airport.name,
    city: airport.city,
    state: airport.state ?? null,
    country: airport.country,
  };

  assertAirportFieldLengths(scalarData);

  const row = await prisma.airport.upsert({
    where,
    create: { ...scalarData, nextPoiSyncAt },
    // Don't overwrite nextPoiSyncAt on update — it's managed by the POI sync
    update: scalarData,
    select: { id: true },
  });

  // location is Unsupported("geography") — set via raw SQL after the upsert
  await prisma.$executeRaw`
    UPDATE "airports" SET location = ST_GeomFromText(${point}, 4326) WHERE id = ${row.id}
  `;
}

// Mirrors the VarChar limits in schema.prisma. Throws before hitting Postgres so
// the error names the field instead of saying "Column: (not available)".
const AIRPORT_VARCHAR_LIMITS = {
  code: 10, faaCode: 10, icaoCode: 10, iataCode: 10,
  facilityType: 20, ownershipType: 5, airportUse: 5,
  siteNumber: 11, faaRegionCode: 3, stateName: 20,
  countyName: 21, countyState: 2,
  ownerName: 35, ownerPhone: 16, managerName: 35, managerPhone: 16,
  magVariation: 3, magVariationYear: 4, sectionalChart: 30,
  directionFromCity: 3, artccBoundaryId: 4, artccResponsibleId: 4,
  notamFacility: 4, notamDService: 10, activationDate: 7, airportStatus: 2,
  arffCertification: 15, npiasAgreements: 7, airspaceAnalysis: 13,
  customsEntry: 10, customsLanding: 10, jointUse: 10, militaryRights: 10,
  fuelTypes: 100, airframeRepair: 5, engineRepair: 5,
  bottledOxygen: 8, bulkOxygen: 8,
  lightingSchedule: 7, beaconSchedule: 7, controlTower: 20,
  unicomFrequency: 7, ctafFrequency: 7, segmentedCircle: 4,
  beaconColor: 3, landingFee: 10, annualOpsDate: 10,
  contractFuel: 10, storageFacilities: 50, otherServices: 255,
  windIndicator: 3, minOperationalNetwork: 10,
  sourceDataset: 255, name: 255, city: 100, state: 10, country: 10,
};

function assertAirportFieldLengths(data) {
  for (const [field, max] of Object.entries(AIRPORT_VARCHAR_LIMITS)) {
    const val = data[field];
    if (typeof val === "string" && val.length > max) {
      throw new Error(
        `Field "${field}" exceeds VarChar(${max}): ${val.length} chars — "${val.slice(0, 60)}${val.length > 60 ? "…" : ""}"`
      );
    }
  }
}
