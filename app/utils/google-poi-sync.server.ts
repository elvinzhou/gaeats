import { createPrisma, type AppPrismaClient } from "~/utils/db.server";
import {
  type DueAirportRow,
  getAirportForPoiSync,
  listAirportsForPoiSync,
  upsertGooglePoiWithLocation,
} from "~/utils/postgis.server";
import { chooseNextPoiSyncAt } from "~/utils/sync-utils.server";

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

const DEFAULT_BATCH_LIMIT = 100;
const DEFAULT_RADIUS_METERS = 5000;
const DEFAULT_POI_CYCLE_DAYS = 365;
const MAX_TRAVEL_TIME_POIS_PER_AIRPORT = 5;

const placeTypeMap = {
  RESTAURANT: ["restaurant", "cafe", "bakery", "bar"],
  ATTRACTION: ["tourist_attraction", "museum", "art_gallery", "park"],
} as const;

/**
 * Enqueues one `poi` message per due airport.
 * Near-zero CPU — just a DB read + queue sends — safe on the free plan.
 */
export async function dispatchPoiSync(cloudflare: CloudflareContext) {
  if (!cloudflare.env.GOOGLE_MAPS_SERVER_API_KEY) return;

  const prisma = createPrisma(cloudflare.env.DATABASE_URL);
  const airports = await listAirportsForPoiSync(prisma);

  const due = sortAirportsForSync(airports)
    .filter((a) => !a.nextPoiSyncAt || new Date(a.nextPoiSyncAt).getTime() <= Date.now())
    .slice(0, DEFAULT_BATCH_LIMIT);

  if (due.length === 0) return;

  await Promise.all(
    due.map((a) => cloudflare.env.SYNC_QUEUE.send({ job: "poi", airportId: a.id }))
  );

  console.log(JSON.stringify({
    level: "info",
    message: "POI sync dispatched",
    count: due.length,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Processes a single airport: fetches RESTAURANT + ATTRACTION places from
 * Google and upserts the results. Designed to run within the free-plan 10ms
 * CPU budget — the work is almost entirely network + DB I/O.
 */
export async function syncAirportPois(airportId: number, cloudflare: CloudflareContext) {
  if (!cloudflare.env.GOOGLE_MAPS_SERVER_API_KEY) return;

  const prisma = createPrisma(cloudflare.env.DATABASE_URL);
  const apiKey = cloudflare.env.GOOGLE_MAPS_SERVER_API_KEY;

  const [airport, allAirports] = await Promise.all([
    getAirportForPoiSync(prisma, airportId),
    listAirportsForPoiSync(prisma),
  ]);
  if (!airport) return;

  for (const type of Object.keys(placeTypeMap) as Array<keyof typeof placeTypeMap>) {
    await syncAirportForType({ prisma, apiKey, airport, requestedType: type, allAirports });
  }
}

async function syncAirportForType(options: {
  prisma: AppPrismaClient;
  apiKey: string;
  airport: DueAirportRow;
  requestedType: keyof typeof placeTypeMap;
  allAirports: DueAirportRow[];
}) {
  const { prisma, airport, requestedType, allAirports } = options;

  const places = await fetchNearbyPlaces(
    { latitude: Number(airport.latitude), longitude: Number(airport.longitude) },
    DEFAULT_RADIUS_METERS,
    requestedType,
    options.apiKey
  );

  if (places.length === 0) {
    await prisma.airport.update({
      where: { id: airport.id },
      data: {
        lastPoiSyncAt: new Date(),
        syncPriority: Math.min((airport.syncPriority ?? 100) + 50, 1000),
        nextPoiSyncAt: chooseNextPoiSyncAt({ airportCount: allAirports.length, desiredCycleDays: 365 }),
      },
    });
    return;
  }

  const prioritisedPlaces = places
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, 10);

  const metricUpdatePromises: Promise<void>[] = [];

  for (let i = 0; i < prioritisedPlaces.length; i++) {
    const place = prioritisedPlaces[i];
    const latitude = place.location?.latitude;
    const longitude = place.location?.longitude;
    if (typeof latitude !== "number" || typeof longitude !== "number" || !place.id) continue;

    const distanceMeters = calculateDistanceMeters(
      { latitude: Number(airport.latitude), longitude: Number(airport.longitude) },
      { latitude, longitude }
    );

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

    if (!poiId) continue;

    const airportPoi = await prisma.airportPoi.upsert({
      where: { airportId_poiId: { airportId: airport.id, poiId } },
      update: { straightLineDistanceMeters: distanceMeters, updatedAt: new Date() },
      create: { airportId: airport.id, poiId, straightLineDistanceMeters: distanceMeters },
    });

    if (i < MAX_TRAVEL_TIME_POIS_PER_AIRPORT) {
      metricUpdatePromises.push(
        updateAirportPoiMetrics({
          prisma,
          apiKey: options.apiKey,
          airportPoiId: airportPoi.id,
          origin: { latitude: Number(airport.latitude), longitude: Number(airport.longitude) },
          destination: { latitude, longitude },
        })
      );
    }
  }

  await Promise.all(metricUpdatePromises);

  await prisma.airport.update({
    where: { id: airport.id },
    data: {
      lastPoiSyncAt: new Date(),
      nextPoiSyncAt: chooseNextPoiSyncAt({
        airportCount: allAirports.length,
        desiredCycleDays: DEFAULT_POI_CYCLE_DAYS,
      }),
    },
  });
}

export async function updateAirportPoiMetrics(options: {
  prisma: AppPrismaClient;
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

function sortAirportsForSync(airports: DueAirportRow[]) {
  return [...airports].sort((left, right) => {
    // 1. Freshness (oldest/never synced first) — in steady state this is sufficient
    //    because priority ordering during initial seeding is baked into nextPoiSyncAt.
    const leftDue = left.nextPoiSyncAt ? new Date(left.nextPoiSyncAt).getTime() : 0;
    const rightDue = right.nextPoiSyncAt ? new Date(right.nextPoiSyncAt).getTime() : 0;
    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    // 2. Tiebreaker (only applies during initial seeding when all airports share
    //    the same nextPoiSyncAt): region first, then airport type within region.
    if (left.regionPriority !== right.regionPriority) {
      return left.regionPriority - right.regionPriority;
    }
    return (left.syncPriority ?? 100) - (right.syncPriority ?? 100);
  });
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}
