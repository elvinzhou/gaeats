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

const MAX_TRAVEL_TIME_POIS_PER_AIRPORT = 5;

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

    // ZERO-RESULT BACKOFF
    if (places.length === 0) {
      console.log(`${airport.code}: Zero results found. Backing off for 1 year.`);
      if (!dryRun) {
        await prisma.airport.update({
          where: { id: airport.id },
          data: {
            lastPoiSyncAt: new Date(),
            syncPriority: Math.min((airport.syncPriority ?? 100) + 50, 1000),
            nextPoiSyncAt: chooseNextPoiSyncAt({
              airportCount: airports.length,
              desiredCycleDays: 365,
            }),
          },
        });
      }
      continue;
    }

    // Prioritize and limit
    const prioritisedPlaces = places
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, 10);

    console.log(
      `${airport.code}: processing top ${prioritisedPlaces.length} ${requestedType.toLowerCase()} candidates`
    );

    const metricUpdatePromises = [];

    for (let i = 0; i < prioritisedPlaces.length; i++) {
      const place = prioritisedPlaces[i];
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

      const airportPoi = await prisma.airportPoi.upsert({
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

      // Only calculate real travel times for the top 5
      if (i < MAX_TRAVEL_TIME_POIS_PER_AIRPORT) {
        metricUpdatePromises.push(
          updateAirportPoiMetrics({
            prisma,
            apiKey,
            airportPoiId: airportPoi.id,
            origin: { latitude: Number(airport.latitude), longitude: Number(airport.longitude) },
            destination: { latitude, longitude },
          })
        );
      }
    }

    // Process all travel time updates concurrently
    await Promise.all(metricUpdatePromises);

    if (!dryRun) {
      await prisma.airport.update({
        where: { id: airport.id },
        data: {
          lastPoiSyncAt: new Date(),
          nextPoiSyncAt: chooseNextPoiSyncAt({
            airportCount: airports.length,
            desiredCycleDays: 90, // 3 month cycle
          }),
        },
      });
    }
  }
} finally {
  await prisma.$disconnect();
}

async function updateAirportPoiMetrics(options) {
  const modes = ["walking", "bicycling", "transit", "driving"];
  const metrics = {
    walkingMinutes: null,
    bikingMinutes: null,
    transitMinutes: null,
    drivingMinutes: null,
  };

  const results = await Promise.all(
    modes.map((mode) =>
      fetchDistanceMatrix({
        apiKey: options.apiKey,
        origin: options.origin,
        destination: options.destination,
        mode,
      })
    )
  );

  results.forEach((result, index) => {
    const mode = modes[index];
    if (result) {
      const minutes = Math.ceil(result.durationValue / 60);
      if (mode === "walking") metrics.walkingMinutes = minutes;
      if (mode === "bicycling") metrics.bikingMinutes = minutes;
      if (mode === "transit") metrics.transitMinutes = minutes;
      if (mode === "driving") metrics.drivingMinutes = minutes;
    }
  });

  // Basic reachability logic
  let preferredMode = null;
  let needsCrewCar = false;
  let needsRideshare = false;

  if (metrics.walkingMinutes && metrics.walkingMinutes <= 20) {
    preferredMode = "WALKING";
  } else if (metrics.bikingMinutes && metrics.bikingMinutes <= 15) {
    preferredMode = "BIKING";
  } else if (metrics.transitMinutes && metrics.transitMinutes <= 30) {
    preferredMode = "TRANSIT";
  } else if (metrics.drivingMinutes) {
    preferredMode = "DRIVING";
    needsRideshare = true; // Default assumption for airport-to-POI
  }

  await options.prisma.airportPoi.update({
    where: { id: options.airportPoiId },
    data: {
      walkingMinutes: metrics.walkingMinutes,
      bikingMinutes: metrics.bikingMinutes,
      transitMinutes: metrics.transitMinutes,
      drivingMinutes: metrics.drivingMinutes,
      preferredMode,
      needsRideshare,
      needsCrewCar: false,
      lastCalculatedAt: new Date(),
    },
  });
}

async function fetchDistanceMatrix(options) {
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", `${options.origin.latitude},${options.origin.longitude}`);
  url.searchParams.set("destinations", `${options.destination.latitude},${options.destination.longitude}`);
  url.searchParams.set("mode", options.mode);
  url.searchParams.set("key", options.apiKey);

  try {
    const response = await fetch(url.toString());
    if (!response.ok) return null;

    const data = await response.json();
    const element = data.rows?.[0]?.elements?.[0];

    if (element?.status === "OK") {
      return {
        distanceValue: element.distance.value,
        durationValue: element.duration.value,
      };
    }
  } catch (error) {
    console.error(`Distance Matrix failed for mode ${options.mode}:`, error);
  }

  return null;
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
