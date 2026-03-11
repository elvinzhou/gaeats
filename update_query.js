const fs = require('fs');
let file = fs.readFileSync('app/utils/postgis.server.ts', 'utf8');

const newInterface = `export interface PoiWithDistance {
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
  walkingMinutes: number | null;
  bikingMinutes: number | null;
  transitMinutes: number | null;
  drivingMinutes: number | null;
  preferredMode: string | null;
  createdAt: Date;
  updatedAt: Date;
}`;

file = file.replace(/export interface PoiWithDistance {[^}]*createdAt: Date;\n  updatedAt: Date;\n}/m, newInterface);

const queryToReplace = `  return prisma.$queryRaw<PoiWithDistance[]>\\\`
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
        ST_MakePoint(\\\${point.longitude}, \\\${point.latitude})
      ) as distance,
      "createdAt",
      "updatedAt"
    FROM "pois"
    WHERE type = \\\${type}
      AND active = true
      AND COALESCE("externalRating", 0) >= \\\${minRating}
      AND ST_DistanceSphere(
        location::geometry,
        ST_MakePoint(\\\${point.longitude}, \\\${point.latitude})
      ) <= \\\${radiusMeters}
    ORDER BY distance ASC
    LIMIT \\\${limit}
  \\\`;`;

const newQuery = `  return prisma.$queryRaw<PoiWithDistance[]>\`
    WITH NearestAirports AS (
      SELECT id
      FROM "airports"
      WHERE ST_DistanceSphere(
        location::geometry,
        ST_MakePoint(\${point.longitude}, \${point.latitude})
      ) <= 1000 -- Assuming the search center is an airport, find airports within 1km (basically itself)
      LIMIT 1
    )
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
        ST_MakePoint(\${point.longitude}, \${point.latitude})
      ) as distance,
      ap."walkingMinutes",
      ap."bikingMinutes",
      ap."transitMinutes",
      ap."drivingMinutes",
      ap."preferredMode",
      p."createdAt",
      p."updatedAt"
    FROM "pois" p
    LEFT JOIN "airport_pois" ap ON ap."poiId" = p.id AND ap."airportId" = (SELECT id FROM NearestAirports)
    WHERE p.type = \${type}
      AND p.active = true
      AND COALESCE(p."externalRating", 0) >= \${minRating}
      AND ST_DistanceSphere(
        p.location::geometry,
        ST_MakePoint(\${point.longitude}, \${point.latitude})
      ) <= \${radiusMeters}
    ORDER BY
      CASE
        WHEN ap."preferredMode" = 'WALKING' THEN 1
        WHEN ap."preferredMode" = 'BICYCLE' THEN 2
        WHEN ap."preferredMode" = 'PUBLIC_TRANSIT' THEN 3
        WHEN ap."preferredMode" = 'DRIVING' THEN 4
        ELSE 5
      END ASC,
      distance ASC
    LIMIT \${limit}
  \`;`;

// Actually we should rewrite findPoisNearbyQuery instead. Let's do it with replace_with_git_merge_diff
