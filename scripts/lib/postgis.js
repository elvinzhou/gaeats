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

  // The airports table has unique constraints on code, faaCode, and icaoCode.
  // `code` is derived (icaoCode || faaCode) and can change between FAA editions,
  // so a plain ON CONFLICT (code) upsert breaks on re-import when an existing row
  // matches on faaCode/icaoCode under a different code. Resolve by any stable
  // identifier, then update in place to preserve the id and all foreign-key relations.
  const existing = await prisma.airport.findFirst({
    where: {
      OR: [
        { code: airport.code },
        ...(airport.faaCode ? [{ faaCode: airport.faaCode }] : []),
        ...(airport.icaoCode ? [{ icaoCode: airport.icaoCode }] : []),
      ],
    },
    select: { id: true, nextPoiSyncAt: true },
  });

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

  await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.airport.update({
        where: { id: existing.id },
        data: {
          ...scalarData,
          // Preserve existing nextPoiSyncAt if already set (mirrors COALESCE behaviour)
          nextPoiSyncAt: existing.nextPoiSyncAt ?? nextPoiSyncAt,
        },
      });
      // location is Unsupported("geography") — must update via raw SQL
      await tx.$executeRaw`
        UPDATE "airports" SET location = ST_GeomFromText(${point}, 4326) WHERE id = ${existing.id}
      `;
    } else {
      // location is NOT NULL and Unsupported, so seed the row with raw SQL, then
      // fill all scalar fields via Prisma's typed update.
      const rows = await tx.$queryRaw`
        INSERT INTO "airports" (code, name, city, country, source, location, "updatedAt")
        VALUES (
          ${airport.code}, ${airport.name}, ${airport.city}, ${airport.country},
          'FAA'::"AirportSource", ST_GeomFromText(${point}, 4326), NOW()
        )
        RETURNING id
      `;
      await tx.airport.update({
        where: { id: rows[0].id },
        data: { ...scalarData, nextPoiSyncAt },
      });
    }
  });
}
