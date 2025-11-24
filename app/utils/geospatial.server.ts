/**
 * Geospatial Utilities for GA Eats
 *
 * This module provides PostGIS-powered geospatial query utilities for finding
 * restaurants near airports using efficient spatial queries.
 *
 * Key Features:
 * - PostGIS ST_Distance for accurate distance calculations
 * - ST_DWithin for efficient radius-based queries
 * - Spatial indexes (GIST) for fast lookups
 * - Haversine distance calculations
 *
 * @module geospatial.server
 */

import type { Prisma } from "~/generated/prisma/client";
import type { PrismaClientWithAccelerate } from "~/utils/db.server";

/**
 * Represents a geographic point (latitude, longitude)
 */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/**
 * Restaurant result with calculated distance
 */
export interface RestaurantWithDistance {
  id: number;
  name: string;
  description: string | null;
  cuisine: string | null;
  rating: number;
  address: string;
  city: string;
  state: string | null;
  country: string;
  latitude: number;
  longitude: number;
  distance: number; // Distance in meters
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Airport result with calculated distance
 */
export interface AirportWithDistance {
  id: number;
  code: string;
  name: string;
  city: string;
  state: string | null;
  country: string;
  latitude: number;
  longitude: number;
  distance: number; // Distance in meters
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Finds restaurants within a specified radius of a point
 *
 * Uses PostGIS ST_DistanceSphere for accurate distance calculations
 * and spatial indexes for efficient lookups.
 *
 * @param prisma - Prisma client instance
 * @param point - Center point (latitude, longitude)
 * @param radiusKm - Search radius in kilometers
 * @param minRating - Minimum rating filter (default: 4.0 for quality restaurants)
 * @param limit - Maximum number of results (default: 20)
 * @returns Array of restaurants with distance, sorted by proximity
 *
 * @example
 * ```typescript
 * const restaurants = await findRestaurantsNearby(
 *   prisma,
 *   { latitude: 37.7749, longitude: -122.4194 },
 *   5.0, // 5km radius
 *   4.0, // Rating >= 4.0
 *   10   // Top 10 results
 * );
 * ```
 */
export async function findRestaurantsNearby(
  prisma: PrismaClientWithAccelerate,
  point: GeoPoint,
  radiusKm: number = 5.0,
  minRating: number = 4.0,
  limit: number = 20
): Promise<RestaurantWithDistance[]> {
  const radiusMeters = radiusKm * 1000;

  // Use raw SQL with PostGIS functions for efficient geospatial queries
  // ST_DistanceSphere: Calculates distance in meters using spherical earth model
  // ST_MakePoint: Creates a point geometry from longitude, latitude (note order!)
  const results = await prisma.$queryRaw<RestaurantWithDistance[]>`
    SELECT
      id,
      "googlePlaceId",
      name,
      description,
      cuisine,
      rating,
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
    FROM "restaurants"
    WHERE rating >= ${minRating}
      AND ST_DistanceSphere(
        location::geometry,
        ST_MakePoint(${point.longitude}, ${point.latitude})
      ) <= ${radiusMeters}
    ORDER BY distance ASC
    LIMIT ${limit}
  `;

  return results;
}

/**
 * Finds airports within a specified radius of a point
 *
 * @param prisma - Prisma client instance
 * @param point - Center point (latitude, longitude)
 * @param radiusKm - Search radius in kilometers
 * @param limit - Maximum number of results (default: 20)
 * @returns Array of airports with distance, sorted by proximity
 *
 * @example
 * ```typescript
 * const airports = await findAirportsNearby(
 *   prisma,
 *   { latitude: 37.7749, longitude: -122.4194 },
 *   50.0 // 50km radius
 * );
 * ```
 */
export async function findAirportsNearby(
  prisma: PrismaClientWithAccelerate,
  point: GeoPoint,
  radiusKm: number = 50.0,
  limit: number = 20
): Promise<AirportWithDistance[]> {
  const radiusMeters = radiusKm * 1000;

  const results = await prisma.$queryRaw<AirportWithDistance[]>`
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

  return results;
}

/**
 * Finds the nearest airport to a given point
 *
 * @param prisma - Prisma client instance
 * @param point - Search point (latitude, longitude)
 * @returns Nearest airport with distance, or null if none found
 *
 * @example
 * ```typescript
 * const nearest = await findNearestAirport(
 *   prisma,
 *   { latitude: 37.7749, longitude: -122.4194 }
 * );
 * ```
 */
export async function findNearestAirport(
  prisma: PrismaClientWithAccelerate,
  point: GeoPoint
): Promise<AirportWithDistance | null> {
  const results = await findAirportsNearby(prisma, point, 500.0, 1);
  return results[0] || null;
}

/**
 * Finds all restaurants near a specific airport
 *
 * This is a convenience function that combines airport lookup with restaurant search
 *
 * @param prisma - Prisma client instance
 * @param airportCode - IATA/ICAO airport code (e.g., "KSFO", "SFO")
 * @param radiusKm - Search radius in kilometers (default: 5km)
 * @param minRating - Minimum rating filter (default: 4.0)
 * @returns Array of restaurants near the airport
 *
 * @example
 * ```typescript
 * const restaurants = await findRestaurantsNearAirport(
 *   prisma,
 *   "KSFO",
 *   5.0,
 *   4.0
 * );
 * ```
 */
export async function findRestaurantsNearAirport(
  prisma: PrismaClientWithAccelerate,
  airportCode: string,
  radiusKm: number = 5.0,
  minRating: number = 4.0
): Promise<RestaurantWithDistance[]> {
  // First, find the airport by code
  const airport = await prisma.$queryRaw<Array<{
    latitude: number;
    longitude: number;
  }>>`
    SELECT
      ST_Y(location::geometry) as latitude,
      ST_X(location::geometry) as longitude
    FROM "airports"
    WHERE UPPER(code) = UPPER(${airportCode})
    LIMIT 1
  `;

  if (!airport || airport.length === 0) {
    throw new Error(`Airport not found: ${airportCode}`);
  }

  const airportLocation = airport[0];

  // Then find restaurants near that airport
  return findRestaurantsNearby(
    prisma,
    airportLocation,
    radiusKm,
    minRating
  );
}

/**
 * Creates a restaurant record with geographic location
 *
 * @param prisma - Prisma client instance
 * @param data - Restaurant data with coordinates
 * @returns Created restaurant record
 *
 * @example
 * ```typescript
 * const restaurant = await createRestaurantWithLocation(prisma, {
 *   name: "The Flying Burger",
 *   address: "123 Airport Rd",
 *   city: "San Francisco",
 *   state: "CA",
 *   country: "US",
 *   cuisine: "American",
 *   rating: 4.5,
 *   latitude: 37.7749,
 *   longitude: -122.4194,
 * });
 * ```
 */
export async function createRestaurantWithLocation(
  prisma: PrismaClientWithAccelerate,
  data: {
    googlePlaceId?: string;
    name: string;
    description?: string;
    cuisine?: string;
    rating: number;
    address: string;
    city: string;
    state?: string;
    country: string;
    latitude: number;
    longitude: number;
  }
) {
  // Create WKT (Well-Known Text) point format for PostGIS
  // Format: POINT(longitude latitude) - note the order!
  const point = `POINT(${data.longitude} ${data.latitude})`;

  await prisma.$queryRaw`
    INSERT INTO "restaurants" (
      "googlePlaceId",
      name,
      description,
      cuisine,
      rating,
      address,
      city,
      state,
      country,
      location,
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${data.googlePlaceId || null},
      ${data.name},
      ${data.description || null},
      ${data.cuisine || null},
      ${data.rating},
      ${data.address},
      ${data.city},
      ${data.state || null},
      ${data.country},
      ST_GeomFromText(${point}, 4326),
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `;
}

/**
 * Creates an airport record with geographic location
 *
 * @param prisma - Prisma client instance
 * @param data - Airport data with coordinates
 * @returns Created airport record
 *
 * @example
 * ```typescript
 * const airport = await createAirportWithLocation(prisma, {
 *   code: "KSFO",
 *   name: "San Francisco International Airport",
 *   city: "San Francisco",
 *   state: "CA",
 *   country: "US",
 *   latitude: 37.6213,
 *   longitude: -122.3790,
 * });
 * ```
 */
export async function createAirportWithLocation(
  prisma: PrismaClientWithAccelerate,
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

/**
 * Calculate distance between two points using Haversine formula
 *
 * This is a JavaScript implementation for client-side calculations or
 * when PostGIS is not available. For server-side queries, prefer PostGIS.
 *
 * @param point1 - First geographic point
 * @param point2 - Second geographic point
 * @returns Distance in kilometers
 *
 * @example
 * ```typescript
 * const distance = calculateHaversineDistance(
 *   { latitude: 37.7749, longitude: -122.4194 },
 *   { latitude: 34.0522, longitude: -118.2437 }
 * );
 * console.log(`Distance: ${distance.toFixed(2)} km`);
 * ```
 */
export function calculateHaversineDistance(
  point1: GeoPoint,
  point2: GeoPoint
): number {
  const R = 6371; // Earth's radius in kilometers
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

/**
 * Convert degrees to radians
 * @param degrees - Angle in degrees
 * @returns Angle in radians
 */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Format distance for display
 * Automatically chooses between meters and kilometers
 *
 * @param distanceMeters - Distance in meters
 * @returns Formatted distance string
 *
 * @example
 * ```typescript
 * formatDistance(500);     // "500 m"
 * formatDistance(1500);    // "1.5 km"
 * formatDistance(10000);   // "10.0 km"
 * ```
 */
export function formatDistance(distanceMeters: number): string {
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }
  const km = distanceMeters / 1000;
  return `${km.toFixed(1)} km`;
}
