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

const DEFAULT_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_LIMIT = 2;
const DEFAULT_RADIUS_METERS = 5000;
const DEFAULT_POI_CYCLE_DAYS = 30;

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

    for (const place of places) {
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
    const leftDue = left.nextPoiSyncAt ? new Date(left.nextPoiSyncAt).getTime() : 0;
    const rightDue = right.nextPoiSyncAt ? new Date(right.nextPoiSyncAt).getTime() : 0;

    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    return (left.syncPriority ?? 100) - (right.syncPriority ?? 100);
  });
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}
