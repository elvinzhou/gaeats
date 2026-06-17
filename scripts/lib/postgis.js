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
    WHERE "facilityType" = 'AIRPORT' OR "facilityType" IS NULL
    ORDER BY "regionPriority" ASC, "syncPriority" ASC
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

  // The airports table has unique constraints on code, faaCode, icaoCode and
  // iataCode. `code` is derived (icaoCode || faaCode) and can change between FAA
  // editions, so a plain `ON CONFLICT (code)` upsert breaks on re-import: when an
  // existing row matches on faaCode/icaoCode under a *different* code, the INSERT
  // isn't deflected and violates airports_faaCode_key, aborting the whole run.
  //
  // Resolve the existing row by any of its stable identifiers, then UPDATE it in
  // place (preserving the id and its POI/foreign-key relations); only INSERT when
  // the airport is genuinely new. `col = NULL` is never true in SQL, so null
  // faaCode/icaoCode values simply match nothing.
  const existing = await prisma.$queryRaw`
    SELECT id FROM "airports"
    WHERE code = ${airport.code}
       OR "faaCode" = ${airport.faaCode}
       OR "icaoCode" = ${airport.icaoCode}
    LIMIT 1
  `;

  if (existing.length > 0) {
    await prisma.$executeRaw`
      UPDATE "airports" SET
        code = ${airport.code},
        "faaCode" = ${airport.faaCode},
        "icaoCode" = ${airport.icaoCode},
        "facilityType" = ${airport.facilityType ?? null},
        "ownershipType" = ${airport.ownershipType ?? null},
        "airportUse" = ${airport.airportUse ?? null},
        "elevation" = ${airport.elevation ?? null},
        "siteNumber" = ${airport.siteNumber ?? null},
        "faaRegionCode" = ${airport.faaRegionCode ?? null},
        "stateName" = ${airport.stateName ?? null},
        "countyName" = ${airport.countyName ?? null},
        "countyState" = ${airport.countyState ?? null},
        "ownerName" = ${airport.ownerName ?? null},
        "ownerPhone" = ${airport.ownerPhone ?? null},
        "managerName" = ${airport.managerName ?? null},
        "managerPhone" = ${airport.managerPhone ?? null},
        "magVariation" = ${airport.magVariation ?? null},
        "magVariationYear" = ${airport.magVariationYear ?? null},
        "trafficPatternAltitude" = ${airport.trafficPatternAltitude ?? null},
        "sectionalChart" = ${airport.sectionalChart ?? null},
        "distanceFromCity" = ${airport.distanceFromCity ?? null},
        "directionFromCity" = ${airport.directionFromCity ?? null},
        "acreage" = ${airport.acreage ?? null},
        "artccBoundaryId" = ${airport.artccBoundaryId ?? null},
        "artccResponsibleId" = ${airport.artccResponsibleId ?? null},
        "notamFacility" = ${airport.notamFacility ?? null},
        "notamDService" = ${airport.notamDService ?? null},
        "activationDate" = ${airport.activationDate ?? null},
        "airportStatus" = ${airport.airportStatus ?? null},
        "arffCertification" = ${airport.arffCertification ?? null},
        "npiasAgreements" = ${airport.npiasAgreements ?? null},
        "airspaceAnalysis" = ${airport.airspaceAnalysis ?? null},
        "customsEntry" = ${airport.customsEntry ?? null},
        "customsLanding" = ${airport.customsLanding ?? null},
        "jointUse" = ${airport.jointUse ?? null},
        "militaryRights" = ${airport.militaryRights ?? null},
        "fuelTypes" = ${airport.fuelTypes ?? null},
        "airframeRepair" = ${airport.airframeRepair ?? null},
        "engineRepair" = ${airport.engineRepair ?? null},
        "bottledOxygen" = ${airport.bottledOxygen ?? null},
        "bulkOxygen" = ${airport.bulkOxygen ?? null},
        "lightingSchedule" = ${airport.lightingSchedule ?? null},
        "beaconSchedule" = ${airport.beaconSchedule ?? null},
        "controlTower" = ${airport.controlTower ?? null},
        "unicomFrequency" = ${airport.unicomFrequency ?? null},
        "ctafFrequency" = ${airport.ctafFrequency ?? null},
        "segmentedCircle" = ${airport.segmentedCircle ?? null},
        "beaconColor" = ${airport.beaconColor ?? null},
        "landingFee" = ${airport.landingFee ?? null},
        "singleEngineCount" = ${airport.singleEngineCount ?? null},
        "multiEngineCount" = ${airport.multiEngineCount ?? null},
        "jetEngineCount" = ${airport.jetEngineCount ?? null},
        "helicopterCount" = ${airport.helicopterCount ?? null},
        "gliderCount" = ${airport.gliderCount ?? null},
        "militaryCount" = ${airport.militaryCount ?? null},
        "ultralightCount" = ${airport.ultralightCount ?? null},
        "annualCommercialOps" = ${airport.annualCommercialOps ?? null},
        "annualCommuterOps" = ${airport.annualCommuterOps ?? null},
        "annualAirTaxiOps" = ${airport.annualAirTaxiOps ?? null},
        "annualGaLocalOps" = ${airport.annualGaLocalOps ?? null},
        "annualGaItinerantOps" = ${airport.annualGaItinerantOps ?? null},
        "annualMilitaryOps" = ${airport.annualMilitaryOps ?? null},
        "annualOpsDate" = ${airport.annualOpsDate ?? null},
        "contractFuel" = ${airport.contractFuel ?? null},
        "storageFacilities" = ${airport.storageFacilities ?? null},
        "otherServices" = ${airport.otherServices ?? null},
        "windIndicator" = ${airport.windIndicator ?? null},
        "minOperationalNetwork" = ${airport.minOperationalNetwork ?? null},
        source = 'FAA'::"AirportSource",
        "sourceDataset" = ${airport.sourceDataset},
        "sourceRecordUpdatedAt" = ${airport.sourceRecordUpdatedAt},
        "sourceRefreshedAt" = CURRENT_TIMESTAMP,
        name = ${airport.name},
        city = ${airport.city},
        state = ${airport.state},
        country = ${airport.country},
        "nextPoiSyncAt" = COALESCE("nextPoiSyncAt", ${nextPoiSyncAt}),
        location = ST_GeomFromText(${point}, 4326),
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = ${existing[0].id}
    `;
    return;
  }

  await prisma.$executeRaw`
    INSERT INTO "airports" (
      code,
      "faaCode",
      "icaoCode",
      "facilityType",
      "ownershipType",
      "airportUse",
      "elevation",
      "siteNumber",
      "faaRegionCode",
      "stateName",
      "countyName",
      "countyState",
      "ownerName",
      "ownerPhone",
      "managerName",
      "managerPhone",
      "magVariation",
      "magVariationYear",
      "trafficPatternAltitude",
      "sectionalChart",
      "distanceFromCity",
      "directionFromCity",
      "acreage",
      "artccBoundaryId",
      "artccResponsibleId",
      "notamFacility",
      "notamDService",
      "activationDate",
      "airportStatus",
      "arffCertification",
      "npiasAgreements",
      "airspaceAnalysis",
      "customsEntry",
      "customsLanding",
      "jointUse",
      "militaryRights",
      "fuelTypes",
      "airframeRepair",
      "engineRepair",
      "bottledOxygen",
      "bulkOxygen",
      "lightingSchedule",
      "beaconSchedule",
      "controlTower",
      "unicomFrequency",
      "ctafFrequency",
      "segmentedCircle",
      "beaconColor",
      "landingFee",
      "singleEngineCount",
      "multiEngineCount",
      "jetEngineCount",
      "helicopterCount",
      "gliderCount",
      "militaryCount",
      "ultralightCount",
      "annualCommercialOps",
      "annualCommuterOps",
      "annualAirTaxiOps",
      "annualGaLocalOps",
      "annualGaItinerantOps",
      "annualMilitaryOps",
      "annualOpsDate",
      "contractFuel",
      "storageFacilities",
      "otherServices",
      "windIndicator",
      "minOperationalNetwork",
      source,
      "sourceDataset",
      "sourceRecordUpdatedAt",
      "sourceRefreshedAt",
      name,
      city,
      state,
      country,
      "nextPoiSyncAt",
      location,
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${airport.code},
      ${airport.faaCode},
      ${airport.icaoCode},
      ${airport.facilityType ?? null},
      ${airport.ownershipType ?? null},
      ${airport.airportUse ?? null},
      ${airport.elevation ?? null},
      ${airport.siteNumber ?? null},
      ${airport.faaRegionCode ?? null},
      ${airport.stateName ?? null},
      ${airport.countyName ?? null},
      ${airport.countyState ?? null},
      ${airport.ownerName ?? null},
      ${airport.ownerPhone ?? null},
      ${airport.managerName ?? null},
      ${airport.managerPhone ?? null},
      ${airport.magVariation ?? null},
      ${airport.magVariationYear ?? null},
      ${airport.trafficPatternAltitude ?? null},
      ${airport.sectionalChart ?? null},
      ${airport.distanceFromCity ?? null},
      ${airport.directionFromCity ?? null},
      ${airport.acreage ?? null},
      ${airport.artccBoundaryId ?? null},
      ${airport.artccResponsibleId ?? null},
      ${airport.notamFacility ?? null},
      ${airport.notamDService ?? null},
      ${airport.activationDate ?? null},
      ${airport.airportStatus ?? null},
      ${airport.arffCertification ?? null},
      ${airport.npiasAgreements ?? null},
      ${airport.airspaceAnalysis ?? null},
      ${airport.customsEntry ?? null},
      ${airport.customsLanding ?? null},
      ${airport.jointUse ?? null},
      ${airport.militaryRights ?? null},
      ${airport.fuelTypes ?? null},
      ${airport.airframeRepair ?? null},
      ${airport.engineRepair ?? null},
      ${airport.bottledOxygen ?? null},
      ${airport.bulkOxygen ?? null},
      ${airport.lightingSchedule ?? null},
      ${airport.beaconSchedule ?? null},
      ${airport.controlTower ?? null},
      ${airport.unicomFrequency ?? null},
      ${airport.ctafFrequency ?? null},
      ${airport.segmentedCircle ?? null},
      ${airport.beaconColor ?? null},
      ${airport.landingFee ?? null},
      ${airport.singleEngineCount ?? null},
      ${airport.multiEngineCount ?? null},
      ${airport.jetEngineCount ?? null},
      ${airport.helicopterCount ?? null},
      ${airport.gliderCount ?? null},
      ${airport.militaryCount ?? null},
      ${airport.ultralightCount ?? null},
      ${airport.annualCommercialOps ?? null},
      ${airport.annualCommuterOps ?? null},
      ${airport.annualAirTaxiOps ?? null},
      ${airport.annualGaLocalOps ?? null},
      ${airport.annualGaItinerantOps ?? null},
      ${airport.annualMilitaryOps ?? null},
      ${airport.annualOpsDate ?? null},
      ${airport.contractFuel ?? null},
      ${airport.storageFacilities ?? null},
      ${airport.otherServices ?? null},
      ${airport.windIndicator ?? null},
      ${airport.minOperationalNetwork ?? null},
      'FAA'::"AirportSource",
      ${airport.sourceDataset},
      ${airport.sourceRecordUpdatedAt},
      CURRENT_TIMESTAMP,
      ${airport.name},
      ${airport.city},
      ${airport.state},
      ${airport.country},
      ${nextPoiSyncAt},
      ST_GeomFromText(${point}, 4326),
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `;
}
