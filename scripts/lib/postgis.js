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

  await prisma.$executeRaw`
    INSERT INTO "airports" (
      code,
      "faaCode",
      "icaoCode",
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
    ON CONFLICT (code) DO UPDATE SET
      "faaCode" = EXCLUDED."faaCode",
      "icaoCode" = EXCLUDED."icaoCode",
      source = EXCLUDED.source,
      "sourceDataset" = EXCLUDED."sourceDataset",
      "sourceRecordUpdatedAt" = EXCLUDED."sourceRecordUpdatedAt",
      "sourceRefreshedAt" = CURRENT_TIMESTAMP,
      name = EXCLUDED.name,
      city = EXCLUDED.city,
      state = EXCLUDED.state,
      country = EXCLUDED.country,
      "nextPoiSyncAt" = COALESCE("airports"."nextPoiSyncAt", EXCLUDED."nextPoiSyncAt"),
      location = EXCLUDED.location,
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}
