/**
 * Geospatial Utilities for GA Eats
 *
 * This module provides app-facing geospatial helpers and delegates all
 * PostGIS-specific SQL to the dedicated postgis module.
 */

import type { AppPrismaClient } from "~/utils/db.server";
import {
  createAirportWithLocationQuery,
  createPoiWithLocationQuery,
  findAirportsNearbyQuery,
  findPoisNearbyQuery,
  findPoisNearAirportQuery,
  getAirportDetailByCode,
  getAirportCoordinatesByCode,
  type AirportWithDistance,
  type GeoPoint,
  type PoiWithDistance,
  type PoiWithTravelTimes,
} from "~/utils/postgis.server";

export type {
  AirportWithDistance,
  GeoPoint,
  PoiWithDistance,
  PoiWithTravelTimes,
} from "~/utils/postgis.server";

export async function findRestaurantsNearby(
  prisma: AppPrismaClient,
  point: GeoPoint,
  radiusKm: number = 5.0,
  minRating: number = 4.0,
  limit: number = 20
): Promise<PoiWithDistance[]> {
  return findPoisNearby(prisma, point, "RESTAURANT", radiusKm, minRating, limit);
}

export async function findAttractionsNearby(
  prisma: AppPrismaClient,
  point: GeoPoint,
  radiusKm: number = 10.0,
  minRating: number = 4.0,
  limit: number = 20
): Promise<PoiWithDistance[]> {
  return findPoisNearby(prisma, point, "ATTRACTION", radiusKm, minRating, limit);
}

export async function findPoisNearby(
  prisma: AppPrismaClient,
  point: GeoPoint,
  type: "RESTAURANT" | "ATTRACTION",
  radiusKm: number = 5.0,
  minRating: number = 4.0,
  limit: number = 20
): Promise<PoiWithDistance[]> {
  return findPoisNearbyQuery(prisma, point, type, radiusKm, minRating, limit);
}

export async function findAirportsNearby(
  prisma: AppPrismaClient,
  point: GeoPoint,
  radiusKm: number = 50.0,
  limit: number = 20
): Promise<AirportWithDistance[]> {
  return findAirportsNearbyQuery(prisma, point, radiusKm, limit);
}

export async function findNearestAirport(
  prisma: AppPrismaClient,
  point: GeoPoint
): Promise<AirportWithDistance | null> {
  const results = await findAirportsNearby(prisma, point, 500.0, 1);
  return results[0] || null;
}

export async function findRestaurantsNearAirport(
  prisma: AppPrismaClient,
  airportCode: string,
  radiusKm: number = 5.0,
  minRating: number = 4.0
): Promise<PoiWithDistance[]> {
  return findPoisNearAirport(
    prisma,
    airportCode,
    "RESTAURANT",
    radiusKm,
    minRating
  );
}

export async function findPoisNearAirport(
  prisma: AppPrismaClient,
  airportCode: string,
  type: "RESTAURANT" | "ATTRACTION",
  radiusKm: number = 5.0,
  minRating: number = 4.0
): Promise<PoiWithTravelTimes[]> {
  const airport = await getAirportDetailByCode(prisma, airportCode);

  if (!airport) {
    throw new Error(`Airport not found: ${airportCode}`);
  }

  return findPoisNearAirportQuery(
    prisma,
    airport.id,
    { latitude: airport.latitude, longitude: airport.longitude },
    type,
    radiusKm,
    minRating,
    20
  );
}

export async function createPoiWithLocation(
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
  await createPoiWithLocationQuery(prisma, data);
}

export async function createAirportWithLocation(
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
  await createAirportWithLocationQuery(prisma, data);
}

export function calculateHaversineDistance(
  point1: GeoPoint,
  point2: GeoPoint
): number {
  const R = 6371;
  const dLat = toRadians(point2.latitude - point1.latitude);
  const dLon = toRadians(point2.longitude - point1.longitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(point1.latitude)) *
      Math.cos(toRadians(point2.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function formatDistance(distanceMeters: number): string {
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }

  const km = distanceMeters / 1000;
  return `${km.toFixed(1)} km`;
}
