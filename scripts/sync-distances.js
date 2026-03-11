import "dotenv/config";
import { createScriptPrisma } from "./lib/db.js";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const limit = Number.parseInt([...args].find(a => a.startsWith("--limit="))?.replace("--limit=", "") || "10", 10);

const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;

if (!apiKey) {
  throw new Error("Set GOOGLE_MAPS_SERVER_API_KEY before running Google Distance sync.");
}

const prisma = createScriptPrisma();

try {
  // Find AirportPoi records that need calculation
  const airportPois = await prisma.$queryRaw`
    SELECT
      ap.id as "airportPoiId",
      a.id as "airportId",
      p.id as "poiId",
      ST_Y(a.location::geometry) as "airportLat",
      ST_X(a.location::geometry) as "airportLng",
      ST_Y(p.location::geometry) as "poiLat",
      ST_X(p.location::geometry) as "poiLng"
    FROM "airport_pois" ap
    JOIN "airports" a ON ap."airportId" = a.id
    JOIN "pois" p ON ap."poiId" = p.id
    WHERE ap."lastCalculatedAt" IS NULL
       OR ap."lastCalculatedAt" < NOW() - INTERVAL '30 days'
    LIMIT ${limit}
  `;

  console.log(`Found ${airportPois.length} routes to calculate.`);

  if (airportPois.length === 0) {
    process.exit(0);
  }

  for (const pair of airportPois) {
    const origin = `${pair.airportLat},${pair.airportLng}`;
    const destination = `${pair.poiLat},${pair.poiLng}`;

    if (dryRun) {
      console.log(`[dry-run] would fetch routes for Airport ${pair.airportId} to POI ${pair.poiId}`);
      continue;
    }

    const modes = ["walking", "bicycling", "transit", "driving"];
    const results = { walking: null, bicycling: null, transit: null, driving: null };

    for (const mode of modes) {
      try {
        const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
        url.searchParams.set("origins", origin);
        url.searchParams.set("destinations", destination);
        url.searchParams.set("mode", mode);
        url.searchParams.set("key", apiKey);

        const res = await fetch(url);
        const data = await res.json();

        if (data.status === "OK" && data.rows[0].elements[0].status === "OK") {
          const durationSeconds = data.rows[0].elements[0].duration.value;
          results[mode] = Math.ceil(durationSeconds / 60);
        } else {
          results[mode] = null;
        }
      } catch (e) {
        console.error(`Failed to fetch ${mode} for pair ${pair.airportPoiId}`, e);
        results[mode] = null;
      }
    }

    let preferredMode = "DRIVING";
    if (results.walking !== null && results.walking <= 20) {
      preferredMode = "WALKING";
    } else if (results.bicycling !== null && results.bicycling <= 30) {
      preferredMode = "BIKING";
    } else if (results.transit !== null && results.transit <= 40) {
      preferredMode = "TRANSIT";
    }

    await prisma.$executeRaw`
      UPDATE "airport_pois"
      SET
        "walkingMinutes" = ${results.walking},
        "bikingMinutes" = ${results.bicycling},
        "transitMinutes" = ${results.transit},
        "drivingMinutes" = ${results.driving},
        "preferredMode" = ${preferredMode}::"AccessMode",
        "lastCalculatedAt" = CURRENT_TIMESTAMP
      WHERE id = ${pair.airportPoiId}
    `;

    console.log(`Updated distances for AirportPoi ${pair.airportPoiId} - ${preferredMode}`);
  }

} finally {
  await prisma.$disconnect();
}
