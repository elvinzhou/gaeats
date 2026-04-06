import type { AppPrismaClient } from "~/utils/db.server";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface PoiWithDistance {
  id: number;
  externalSourceId: string | null;
  type: "RESTAURANT" | "ATTRACTION";
  name: string;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  cuisine: string | null;
  externalRating: number | null;
  pilotRating: number | null;
  address: string;
  city: string;
  state: string | null;
  country: string;
  latitude: number;
  longitude: number;
  distance: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AirportWithDistance {
  id: number;
  code: string;
  name: string;
  city: string;
  state: string | null;
  country: string;
  latitude: number;
  longitude: number;
  distance: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AirportCoordinates {
  latitude: number;
  longitude: number;
}

export interface AirportDetailRow {
  id: number;
  code: string;
  name: string;
  city: string;
  state: string | null;
  country: string;
  fboName: string | null;
  fboPhone: string | null;
  fboWebsite: string | null;
  notes: string | null;
  latitude: number;
  longitude: number;
}

export interface DueAirportRow {
  id: number;
  code: string;
  city: string;
  state: string | null;
  nextPoiSyncAt: Date | string | null;
  syncPriority: number;
  regionPriority: number;
  latitude: number;
  longitude: number;
}

export interface PoiWithTravelTimes extends PoiWithDistance {
  walkingMinutes: number | null;
  bikingMinutes: number | null;
  transitMinutes: number | null;
  drivingMinutes: number | null;
  preferredMode: string | null;
  needsRideshare: boolean | null;
  needsCrewCar: boolean | null;
}
export async function findPoisNearbyQuery(
  prisma: AppPrismaClient,
  point: GeoPoint,
  type: "RESTAURANT" | "ATTRACTION",
  radiusKm: number,
  minRating: number,
  limit: number
) {
  const radiusMeters = radiusKm * 1000;

  return prisma.$queryRaw<PoiWithDistance[]>`
    SELECT
      id,
      "externalSourceId",
      type,
      name,
      category,
      subcategory,
      description,
      cuisine,
      "externalRating",
      "pilotRating",
      address,
      city,
      state,
      country,
      ST_Y(location::geometry) as latitude,
      ST_X(location::geometry) as longitude,
      ST_DistanceSphere(
        location::geometry,
        ST_MakePoint(${point.longitude}, ${point.latitude})
      ) as distance,
      "createdAt",
      "updatedAt"
    FROM "pois"
    WHERE type = ${type}
      AND active = true
      AND COALESCE("externalRating", 0) >= ${minRating}
      AND ST_DistanceSphere(
        location::geometry,
        ST_MakePoint(${point.longitude}, ${point.latitude})
      ) <= ${radiusMeters}
    ORDER BY distance ASC
    LIMIT ${limit}
  `;
}

export async function findPoisNearAirportQuery(
  prisma: AppPrismaClient,
  airportId: number,
  airportLocation: GeoPoint,
  type: "RESTAURANT" | "ATTRACTION",
  radiusKm: number,
  minRating: number,
  limit: number
) {
  const radiusMeters = radiusKm * 1000;

  return prisma.$queryRaw<PoiWithTravelTimes[]>`
    SELECT
      p.id,
      p."externalSourceId",
      p.type,
      p.name,
      p.category,
      p.subcategory,
      p.description,
      p.cuisine,
      p."externalRating",
      p."pilotRating",
      p.address,
      p.city,
      p.state,
      p.country,
      ST_Y(p.location::geometry) as latitude,
      ST_X(p.location::geometry) as longitude,
      ST_DistanceSphere(
        p.location::geometry,
        ST_MakePoint(${airportLocation.longitude}, ${airportLocation.latitude})
      ) as distance,
      ap."walkingMinutes",
      ap."bikingMinutes",
      ap."transitMinutes",
      ap."drivingMinutes",
      ap."preferredMode",
      ap."needsRideshare",
      ap."needsCrewCar",
      p."createdAt",
      p."updatedAt"
    FROM "pois" p
    LEFT JOIN "airport_pois" ap ON ap."poiId" = p.id AND ap."airportId" = ${airportId}
    WHERE p.type = ${type}
      AND p.active = true
      AND COALESCE(p."externalRating", 0) >= ${minRating}
      AND ST_DistanceSphere(
        p.location::geometry,
        ST_MakePoint(${airportLocation.longitude}, ${airportLocation.latitude})
      ) <= ${radiusMeters}
    ORDER BY
      CASE
        WHEN ap."preferredMode" = 'WALKING' THEN 1
        WHEN ap."preferredMode" = 'BIKING' THEN 2
        WHEN ap."preferredMode" = 'TRANSIT' THEN 3
        WHEN ap."preferredMode" = 'DRIVING' THEN 4
        ELSE 5
      END ASC,
      distance ASC
    LIMIT ${limit}
  `;
}

export async function findAirportsNearbyQuery(
  prisma: AppPrismaClient,
  point: GeoPoint,
  radiusKm: number,
  limit: number
) {
  const radiusMeters = radiusKm * 1000;

  return prisma.$queryRaw<AirportWithDistance[]>`
    SELECT
      id,
      code,
      name,
      city,
      state,
      country,
      ST_Y(location::geometry) as latitude,
      ST_X(location::geometry) as longitude,
      ST_DistanceSphere(
        location::geometry,
        ST_MakePoint(${point.longitude}, ${point.latitude})
      ) as distance,
      "createdAt",
      "updatedAt"
    FROM "airports"
    WHERE ST_DistanceSphere(
      location::geometry,
      ST_MakePoint(${point.longitude}, ${point.latitude})
    ) <= ${radiusMeters}
    ORDER BY distance ASC
    LIMIT ${limit}
  `;
}

export async function getAirportCoordinatesByCode(
  prisma: AppPrismaClient,
  airportCode: string
) {
  const airports = await prisma.$queryRaw<AirportCoordinates[]>`
    SELECT
      ST_Y(location::geometry) as latitude,
      ST_X(location::geometry) as longitude
    FROM "airports"
    WHERE UPPER(code) = UPPER(${airportCode})
    LIMIT 1
  `;

  return airports[0] ?? null;
}

export async function getAirportDetailByCode(
  prisma: AppPrismaClient,
  airportCode: string
) {
  const airports = await prisma.$queryRaw<AirportDetailRow[]>`
    SELECT
      id,
      code,
      name,
      city,
      state,
      country,
      "fboName",
      "fboPhone",
      "fboWebsite",
      notes,
      ST_Y(location::geometry) as latitude,
      ST_X(location::geometry) as longitude
    FROM "airports"
    WHERE UPPER(code) = UPPER(${airportCode})
    LIMIT 1
  `;

  return airports[0] ?? null;
}

export async function getAirportSummaryByCode(
  prisma: AppPrismaClient,
  airportCode: string
) {
  const airports = await prisma.$queryRaw<AirportWithDistance[]>`
    SELECT
      id,
      code,
      name,
      city,
      state,
      country,
      ST_Y(location::geometry) as latitude,
      ST_X(location::geometry) as longitude,
      0::double precision as distance,
      "createdAt",
      "updatedAt"
    FROM "airports"
    WHERE UPPER(code) = UPPER(${airportCode})
    LIMIT 1
  `;

  return airports[0] ?? null;
}

export async function createPoiWithLocationQuery(
  prisma: AppPrismaClient,
  data: {
    source: "GOOGLE_MAPS" | "YELP" | "MANUAL" | "CLAIMED_LISTING" | "IMPORT";
    externalSourceId?: string;
    type: "RESTAURANT" | "ATTRACTION";
    name: string;
    category?: string;
    subcategory?: string;
    description?: string;
    cuisine?: string;
    externalRating?: number;
    address: string;
    city: string;
    state?: string;
    country: string;
    latitude: number;
    longitude: number;
  }
) {
  const point = `POINT(${data.longitude} ${data.latitude})`;

  await prisma.$queryRaw`
    INSERT INTO "pois" (
      source,
      "externalSourceId",
      type,
      name,
      category,
      subcategory,
      description,
      cuisine,
      "externalRating",
      address,
      city,
      state,
      country,
      active,
      location,
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${data.source}::"ExternalSource",
      ${data.externalSourceId || null},
      ${data.type}::"PoiType",
      ${data.name},
      ${data.category || null},
      ${data.subcategory || null},
      ${data.description || null},
      ${data.cuisine || null},
      ${data.externalRating ?? null},
      ${data.address},
      ${data.city},
      ${data.state || null},
      ${data.country},
      true,
      ST_GeomFromText(${point}, 4326),
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `;
}

export async function createAirportWithLocationQuery(
  prisma: AppPrismaClient,
  data: {
    code: string;
    name: string;
    city: string;
    state?: string;
    country: string;
    latitude: number;
    longitude: number;
  }
) {
  const point = `POINT(${data.longitude} ${data.latitude})`;

  await prisma.$queryRaw`
    INSERT INTO "airports" (
      code,
      name,
      city,
      state,
      country,
      location,
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${data.code},
      ${data.name},
      ${data.city},
      ${data.state || null},
      ${data.country},
      ST_GeomFromText(${point}, 4326),
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `;
}

export async function listAirportsForPoiSync(
  prisma: AppPrismaClient,
  airportCode?: string
) {
  if (airportCode) {
    return prisma.$queryRaw<DueAirportRow[]>`
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
  return prisma.$queryRaw<DueAirportRow[]>`
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

export async function upsertGooglePoiWithLocation(
  prisma: AppPrismaClient,
  data: {
    externalSourceId: string;
    requestedType: "RESTAURANT" | "ATTRACTION";
    name: string;
    category: string | null;
    subcategory: string | null;
    cuisine: string | null;
    description: string | null;
    address: string;
    city: string;
    state: string | null;
    priceLevel: number | null;
    externalRating: number | null;
    externalReviewCount: number | null;
    url: string | null;
    phone: string | null;
    hoursJson: string;
    latitude: number;
    longitude: number;
  }
) {
  const point = `POINT(${data.longitude} ${data.latitude})`;

  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
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

export async function upsertFaaAirportWithLocation(
  prisma: AppPrismaClient,
  airport: {
    code: string;
    faaCode: string | null;
    icaoCode: string | null;
    name: string;
    city: string;
    state: string | null;
    country: string;
    sourceDataset: string | null;
    sourceRecordUpdatedAt: Date | null;
    latitude: number;
    longitude: number;
  },
  syncPriority: number
) {
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
      "syncPriority",
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
      CURRENT_TIMESTAMP,
      ${syncPriority},
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
      "syncPriority" = COALESCE("airports"."syncPriority", EXCLUDED."syncPriority"),
      location = EXCLUDED.location,
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}
