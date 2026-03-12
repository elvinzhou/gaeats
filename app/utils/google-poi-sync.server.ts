import { prisma } from "~/utils/db.server";
import {
  type DueAirportRow,
  listAirportsForPoiSync,
  upsertGooglePoiWithLocation,
} from "~/utils/postgis.server";

type CloudflareContext = {
  env: Env;
  ctx: ExecutionContext;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string | number;
  websiteUri?: string;
  googleMapsUri?: string;
  nationalPhoneNumber?: string;
  regularOpeningHours?: unknown;
  primaryType?: string;
  types?: string[];
  editorialSummary?: { text?: string };
};

const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000; // Check once per hour
const DEFAULT_BATCH_LIMIT = 1;                   // 1 airport per check
const DEFAULT_RADIUS_METERS = 5000;
const DEFAULT_POI_CYCLE_DAYS = 90;               // Refresh once every 3 months
const MAX_TRAVEL_TIME_POIS_PER_AIRPORT = 5;      // Only calculate real travel times for top 5 POIs

const placeTypeMap = {
  RESTAURANT: ["restaurant", "cafe", "bakery", "bar"],
  ATTRACTION: ["tourist_attraction", "museum", "art_gallery", "park"],
} as const;

let lastCheckedAt = 0;
let nextType: keyof typeof placeTypeMap = "RESTAURANT";

export async function refreshGooglePoiSyncIfDue(cloudflare: CloudflareContext) {
  if (!cloudflare.env.GOOGLE_MAPS_SERVER_API_KEY) {
    return;
  }

  const now = Date.now();
  if (now - lastCheckedAt < DEFAULT_CHECK_INTERVAL_MS) {
    return;
  }

  lastCheckedAt = now;

  const scheduledType = nextType;
  nextType = nextType === "RESTAURANT" ? "ATTRACTION" : "RESTAURANT";

  await syncGooglePois({
    apiKey: cloudflare.env.GOOGLE_MAPS_SERVER_API_KEY,
    requestedType: scheduledType,
    limit: DEFAULT_BATCH_LIMIT,
    radiusMeters: DEFAULT_RADIUS_METERS,
  });
}

async function syncGooglePois(options: {
  apiKey: string;
  requestedType: keyof typeof placeTypeMap;
  limit: number;
  radiusMeters: number;
}) {
  const airports = await listAirportsForPoiSync(prisma);

  const dueAirports = sortAirportsForSync(airports)
    .filter((airport) => {
      if (!airport.nextPoiSyncAt) return true;
      return new Date(airport.nextPoiSyncAt).getTime() <= Date.now();
    })
    .slice(0, Math.max(1, options.limit));

  if (dueAirports.length === 0) {
    return;
  }

    for (const airport of dueAirports) {
    const places = await fetchNearbyPlaces(
      {
        latitude: Number(airport.latitude),
        longitude: Number(airport.longitude),
      },
      options.radiusMeters,
      options.requestedType,
      options.apiKey
    );

    // ZERO-RESULT BACKOFF: If no POIs found, push sync out to 1 year and deprioritize
    if (places.length === 0) {
      await prisma.airport.update({
        where: { id: airport.id },
        data: {
          lastPoiSyncAt: new Date(),
          syncPriority: Math.min((airport.syncPriority ?? 100) + 50, 1000), // Deprioritize
          nextPoiSyncAt: chooseNextPoiSyncAt({
            airportCount: airports.length,
            desiredCycleDays: 365, // Check again in a year
          }),
        },
      });
      continue;
    }

    // Limit POIs processed per sync to save budget
    const prioritisedPlaces = places
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, 10); // Sync basic info for top 10

    for (let i = 0; i < prioritisedPlaces.length; i++) {
      const place = prioritisedPlaces[i];
      const latitude = place.location?.latitude;
      const longitude = place.location?.longitude;

      if (typeof latitude !== "number" || typeof longitude !== "number" || !place.id) {
        continue;
      }

      const distanceMeters = calculateDistanceMeters(
        { latitude: Number(airport.latitude), longitude: Number(airport.longitude) },
        { latitude, longitude }
      );

      const poiId = await upsertGooglePoiWithLocation(prisma, {
        externalSourceId: place.id,
        requestedType: options.requestedType,
        name: place.displayName?.text ?? "Unnamed place",
        category: derivePoiCategory(place),
        subcategory: derivePoiSubcategory(place),
        cuisine: options.requestedType === "RESTAURANT" ? derivePoiCategory(place) : null,
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

      // Fetch real travel times ONLY for the top 5 per sync to stay within free tier
      if (i < MAX_TRAVEL_TIME_POIS_PER_AIRPORT) {
        await updateAirportPoiMetrics({
          prisma,
          apiKey: options.apiKey,
          airportPoiId: airportPoi.id,
          origin: { latitude: Number(airport.latitude), longitude: Number(airport.longitude) },
          destination: { latitude, longitude },
        });
      }
    }

    await prisma.airport.update({
      where: { id: airport.id },
      data: {
        lastPoiSyncAt: new Date(),
        nextPoiSyncAt: chooseNextPoiSyncAt({
          airportCount: airports.length,
          desiredCycleDays: DEFAULT_POI_CYCLE_DAYS,
        }),
      },
    });
  }
}

async function updateAirportPoiMetrics(options: {
  prisma: typeof prisma;
  apiKey: string;
  airportPoiId: number;
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
}) {
  const modes = ["walking", "bicycling", "transit", "driving"] as const;
  const metrics: Record<string, number | null> = {
    walkingMinutes: null,
    bikingMinutes: null,
    transitMinutes: null,
    drivingMinutes: null,
  };

  for (const mode of modes) {
    const result = await fetchDistanceMatrix({
      apiKey: options.apiKey,
      origin: options.origin,
      destination: options.destination,
      mode,
    });

    if (result) {
      const minutes = Math.ceil(result.durationValue / 60);
      if (mode === "walking") metrics.walkingMinutes = minutes;
      if (mode === "bicycling") metrics.bikingMinutes = minutes;
      if (mode === "transit") metrics.transitMinutes = minutes;
      if (mode === "driving") metrics.drivingMinutes = minutes;
    }
  }

  // Basic reachability logic
  let preferredMode: string | null = null;
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
      preferredMode: preferredMode as any,
      needsRideshare,
      needsCrewCar: false, // For now, crew car is a manual/verified fact
      lastCalculatedAt: new Date(),
    },
  });
}

async function fetchDistanceMatrix(options: {
  apiKey: string;
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  mode: "walking" | "bicycling" | "transit" | "driving";
}) {
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", `${options.origin.latitude},${options.origin.longitude}`);
  url.searchParams.set("destinations", `${options.destination.latitude},${options.destination.longitude}`);
  url.searchParams.set("mode", options.mode);
  url.searchParams.set("key", options.apiKey);

  try {
    const response = await fetch(url.toString());
    if (!response.ok) return null;

    const data = (await response.json()) as any;
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

async function fetchNearbyPlaces(
  center: { latitude: number; longitude: number },
  radius: number,
  type: keyof typeof placeTypeMap,
  apiKey: string
) {
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

  const payload = (await response.json()) as { places?: GooglePlace[] };
  return payload.places ?? [];
}

function normalizePriceLevel(priceLevel: string | number | undefined) {
  if (typeof priceLevel === "number") {
    return priceLevel;
  }

  const mapping: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };

  return priceLevel ? mapping[priceLevel] ?? null : null;
}

function calculateDistanceMeters(
  pointA: { latitude: number; longitude: number },
  pointB: { latitude: number; longitude: number }
) {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(pointB.latitude - pointA.latitude);
  const dLon = toRadians(pointB.longitude - pointA.longitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(pointA.latitude)) *
      Math.cos(toRadians(pointB.latitude)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function derivePoiCategory(place: GooglePlace) {
  if (place.primaryType) {
    return place.primaryType;
  }

  return place.types?.[0] ?? null;
}

function derivePoiSubcategory(place: GooglePlace) {
  return place.types?.[1] ?? null;
}

function chooseNextPoiSyncAt(options: {
  now?: Date;
  airportCount?: number;
  desiredCycleDays?: number;
  minDays?: number;
}) {
  const {
    now = new Date(),
    airportCount = 1,
    desiredCycleDays = 30,
    minDays = 1,
  } = options;

  const dailyBatchSize = Math.max(1, Math.ceil(airportCount / desiredCycleDays));
  const spacingDays = Math.max(minDays, Math.floor(desiredCycleDays / dailyBatchSize));

  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + spacingDays);
  return next;
}

function sortAirportsForSync(airports: DueAirportRow[]) {
  return [...airports].sort((left, right) => {
    // 1. Regional priority (NorCal > West Coast > Other)
    if (left.regionPriority !== right.regionPriority) {
      return left.regionPriority - right.regionPriority;
    }

    // 2. Freshness (Oldest sync/never synced first)
    const leftDue = left.nextPoiSyncAt ? new Date(left.nextPoiSyncAt).getTime() : 0;
    const rightDue = right.nextPoiSyncAt ? new Date(right.nextPoiSyncAt).getTime() : 0;

    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    // 3. Explicit sync priority
    return (left.syncPriority ?? 100) - (right.syncPriority ?? 100);
  });
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}
