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

  // Prioritize NorCal (Bay Area) first, then West Coast states (CA, OR, WA)
  // This helps with the initial launch strategy focused on the West Coast.
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
