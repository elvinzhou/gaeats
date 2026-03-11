import "dotenv/config";
import { createScriptPrisma } from "./lib/db.js";
import {
  listAirportsForPoiSync,
  upsertGooglePoiWithLocation,
} from "./lib/postgis.js";
import {
  calculateDistanceMeters,
  chooseNextPoiSyncAt,
  derivePoiCategory,
  derivePoiSubcategory,
  normalizePoiType,
  sortAirportsForSync,
} from "./lib/sync-utils.js";

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(
    "Usage: node scripts/sync-google-pois.js [--airport=KPAO] [--type=RESTAURANT|ATTRACTION] [--radius=5000] [--limit=5] [--dry-run]"
  );
  process.exit(0);
}

const airportFilter = [...args]
  .find((arg) => arg.startsWith("--airport="))
  ?.replace("--airport=", "")
  .toUpperCase();
const requestedType = normalizePoiType(
  [...args].find((arg) => arg.startsWith("--type="))?.replace("--type=", "")
);
const radiusMeters = Number.parseInt(
  [...args].find((arg) => arg.startsWith("--radius="))?.replace("--radius=", "") ??
    "5000",
  10
);
const limit = Number.parseInt(
  [...args].find((arg) => arg.startsWith("--limit="))?.replace("--limit=", "") ?? "5",
  10
);
const dryRun = args.has("--dry-run");

const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;

if (!apiKey) {
  throw new Error("Set GOOGLE_MAPS_SERVER_API_KEY before running Google POI sync.");
}

const prisma = createScriptPrisma();

const placeTypeMap = {
  RESTAURANT: ["restaurant", "cafe", "bakery", "bar"],
  ATTRACTION: ["tourist_attraction", "museum", "art_gallery", "park"],
};

try {
  const airports = await listAirportsForPoiSync(prisma, airportFilter);

  const dueAirports = airportFilter
    ? airports
    : sortAirportsForSync(airports)
        .filter((airport) => {
          if (!airport.nextPoiSyncAt) return true;
          return new Date(airport.nextPoiSyncAt).getTime() <= Date.now();
        })
        .slice(0, Math.max(1, limit));

  console.log(
    `syncing ${dueAirports.length} airport(s) for ${requestedType.toLowerCase()} refresh`
  );

  for (const airport of dueAirports) {
    const places = await fetchNearbyPlaces(
      {
        latitude: Number(airport.latitude),
        longitude: Number(airport.longitude),
      },
      radiusMeters,
      requestedType,
      apiKey
    );

    console.log(
      `${airport.code}: fetched ${places.length} ${requestedType.toLowerCase()} candidates`
    );

    for (const place of places) {
      const latitude = place.location?.latitude;
      const longitude = place.location?.longitude;

      if (typeof latitude !== "number" || typeof longitude !== "number") {
        continue;
      }

      const distanceMeters = calculateDistanceMeters(
        { latitude: Number(airport.latitude), longitude: Number(airport.longitude) },
        { latitude, longitude }
      );

      if (dryRun) {
        console.log(`[dry-run] would upsert POI ${place.displayName?.text ?? place.id}`);
        continue;
      }

      const poiId = await upsertGooglePoiWithLocation(prisma, {
        externalSourceId: place.id,
        requestedType,
        name: place.displayName?.text ?? "Unnamed place",
        category: derivePoiCategory(place),
        subcategory: derivePoiSubcategory(place),
        cuisine: requestedType === "RESTAURANT" ? derivePoiCategory(place) : null,
        description: place.editorialSummary?.text ?? null,
        address: place.formattedAddress ?? "Unknown address",
        city: airport.city ?? "",
        state: airport.state ?? null,
        priceLevel: normalizePriceLevel(place.priceLevel),
        externalRating: place.rating ?? null,
        externalReviewCount: place.userRatingCount ?? null,
        url: place.websiteUri ?? place.googleMapsUri ?? null,
        phone: place.nationalPhoneNumber ?? null,
        hoursJson: JSON.stringify(place.regularOpeningHours ?? null),
        latitude,
        longitude,
      });

      if (!poiId) {
        continue;
      }

      await prisma.airportPoi.upsert({
        where: {
          airportId_poiId: {
            airportId: airport.id,
            poiId,
          },
        },
        update: {
          straightLineDistanceMeters: distanceMeters,
          updatedAt: new Date(),
        },
        create: {
          airportId: airport.id,
          poiId,
          straightLineDistanceMeters: distanceMeters,
        },
      });
    }

    if (!dryRun) {
      await prisma.airport.update({
        where: { id: airport.id },
        data: {
          lastPoiSyncAt: new Date(),
          nextPoiSyncAt: chooseNextPoiSyncAt({
            airportCount: airports.length,
            desiredCycleDays: 30,
          }),
        },
      });
    }
  }
} finally {
  await prisma.$disconnect();
}

async function fetchNearbyPlaces(center, radius, type, apiKey) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.websiteUri,places.googleMapsUri,places.nationalPhoneNumber,places.regularOpeningHours,places.primaryType,places.types,places.editorialSummary",
    },
    body: JSON.stringify({
      includedTypes: placeTypeMap[type],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: {
            latitude: center.latitude,
            longitude: center.longitude,
          },
          radius,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Places sync failed: ${response.status} ${body}`);
  }

  const payload = await response.json();
  return payload.places ?? [];
}

function normalizePriceLevel(priceLevel) {
  if (typeof priceLevel === "number") {
    return priceLevel;
  }

  const mapping = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };

  return mapping[priceLevel] ?? null;
}
