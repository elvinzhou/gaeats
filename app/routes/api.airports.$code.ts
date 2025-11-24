/**
 * API Route: Airport Details with Nearby Restaurants
 * GET /api/airports/:code
 *
 * Returns detailed information about a specific airport and all restaurants
 * within a specified radius.
 *
 * Path Parameters:
 * - code (required): IATA/ICAO airport code (e.g., "KSFO", "SFO")
 *
 * Query Parameters:
 * - distance (optional): Search radius in kilometers (default: 5.0)
 * - minRating (optional): Minimum rating filter (default: 4.0)
 *
 * Example:
 * GET /api/airports/KSFO?distance=10&minRating=4.5
 *
 * Response:
 * {
 *   "airport": {
 *     "code": "KSFO",
 *     "name": "San Francisco International Airport",
 *     "city": "San Francisco",
 *     "state": "CA",
 *     "latitude": 37.6213,
 *     "longitude": -122.3790
 *   },
 *   "restaurants": [...],
 *   "count": 15
 * }
 */

import type { Route } from "./+types/api.airports.$code";
import { json } from "react-router";
import { createPrismaClient } from "~/utils/db.server";
import { findRestaurantsNearAirport } from "~/utils/geospatial.server";

/**
 * Loader function - handles GET requests
 * Fetches airport details and nearby restaurants
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { code } = params;

  // Validate airport code parameter
  if (!code || code.trim().length === 0) {
    return json(
      {
        error: "Invalid airport code",
        message: "Airport code is required",
        example: "/api/airports/KSFO",
      },
      { status: 400 }
    );
  }

  // Parse query parameters
  const url = new URL(request.url);
  const distance = parseFloat(url.searchParams.get("distance") || "5.0");
  const minRating = parseFloat(url.searchParams.get("minRating") || "4.0");

  // Validate parameters
  if (distance <= 0 || distance > 100) {
    return json(
      {
        error: "Invalid distance",
        message: "Distance must be between 0 and 100 kilometers",
      },
      { status: 400 }
    );
  }

  try {
    // Create Prisma client
    const prisma = createPrismaClient(context.cloudflare.env.DATABASE_URL);

    // First, get the airport details
    const airportResult = await prisma.$queryRaw<Array<{
      id: number;
      code: string;
      name: string;
      city: string;
      state: string | null;
      country: string;
      latitude: number;
      longitude: number;
      createdAt: Date;
      updatedAt: Date;
    }>>`
      SELECT
        id,
        code,
        name,
        city,
        state,
        country,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        "createdAt",
        "updatedAt"
      FROM "airports"
      WHERE UPPER(code) = UPPER(${code})
      LIMIT 1
    `;

    // Check if airport exists
    if (!airportResult || airportResult.length === 0) {
      return json(
        {
          error: "Airport not found",
          message: `No airport found with code: ${code}`,
          suggestion: "Check the airport code and try again. Use IATA or ICAO codes (e.g., KSFO, SFO).",
        },
        { status: 404 }
      );
    }

    const airport = airportResult[0];

    // Find restaurants near this airport
    const restaurants = await findRestaurantsNearAirport(
      prisma,
      code,
      distance,
      minRating
    );

    // Return combined response
    return json({
      airport: {
        code: airport.code,
        name: airport.name,
        city: airport.city,
        state: airport.state,
        country: airport.country,
        latitude: airport.latitude,
        longitude: airport.longitude,
      },
      restaurants,
      search: {
        radiusKm: distance,
        minRating,
      },
      count: restaurants.length,
    });
  } catch (error) {
    console.error(`Error fetching airport ${code}:`, error);

    return json(
      {
        error: "Database error",
        message: "Failed to fetch airport data. Please try again later.",
      },
      { status: 500 }
    );
  }
}
