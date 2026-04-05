/**
 * API Route: Airport Details with Nearby POIs
 * GET /api/airports/:code
 *
 * Returns detailed information about a specific airport and nearby POIs within
 * a specified radius.
 *
 * Path Parameters:
 * - code (required): IATA/ICAO airport code (e.g., "KSFO", "SFO")
 *
 * Query Parameters:
 * - distance (optional): Search radius in kilometers (default: 5.0)
 * - minRating (optional): Minimum rating filter (default: 4.0)
 *
 * Query Parameters:
 * - type (optional): `RESTAURANT` or `ATTRACTION` (default: `RESTAURANT`)
 *
 * Example:
 * GET /api/airports/KSFO?distance=10&minRating=4.5&type=ATTRACTION
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
 *   "pois": [...],
 *   "count": 15
 * }
 */

import { prisma } from "~/utils/db.server";
import { findPoisNearAirport } from "~/utils/geospatial.server";
import { getAirportSummaryByCode } from "~/utils/postgis.server";
import { logger } from "~/utils/logger.server";

interface LoaderArgs {
  params: { code: string };
  request: Request;
  context: { cloudflare: { env: Env } };
}

/**
 * Loader function - handles GET requests
 * Fetches airport details and nearby POIs
 */
export async function loader({ params, request, context }: LoaderArgs) {
  const { code } = params;

  // Validate airport code parameter: 3-letter IATA or 4-char ICAO (letters/digits only)
  const cleanCode = code.trim().toUpperCase();
  if (!cleanCode || !/^[A-Z0-9]{3,4}$/.test(cleanCode)) {
    return Response.json(
      {
        error: "Invalid airport code",
        message: "Airport code must be a 3-letter IATA or 4-character ICAO code (e.g., SFO or KSFO)",
        example: "/api/airports/KSFO",
      },
      { status: 400 }
    );
  }

  // Parse query parameters
  const url = new URL(request.url);
  const distance = parseFloat(url.searchParams.get("distance") || "5.0");
  const minRating = parseFloat(url.searchParams.get("minRating") || "4.0");
  const requestedType = url.searchParams.get("type") || "RESTAURANT";

  // Validate parameters
  if (distance <= 0 || distance > 100) {
    return Response.json(
      {
        error: "Invalid distance",
        message: "Distance must be between 0 and 100 kilometers",
      },
      { status: 400 }
    );
  }

  if (requestedType !== "RESTAURANT" && requestedType !== "ATTRACTION") {
    return Response.json(
      {
        error: "Invalid type",
        message: "Type must be either 'RESTAURANT' or 'ATTRACTION'",
      },
      { status: 400 }
    );
  }

  try {
    // Get singleton Prisma client
    const db = prisma;

    // First, get the airport details
    const airport = await getAirportSummaryByCode(db, cleanCode);

    // Check if airport exists
    if (!airport) {
      return Response.json(
        {
          error: "Airport not found",
          message: `No airport found with code: ${cleanCode}`,
          suggestion: "Check the airport code and try again. Use IATA or ICAO codes (e.g., KSFO, SFO).",
        },
        { status: 404 }
      );
    }

    // Find POIs near this airport
    const pois = await findPoisNearAirport(
      db,
      cleanCode,
      requestedType as "RESTAURANT" | "ATTRACTION",
      distance,
      minRating
    );

    // Return combined response
    return Response.json({
      airport: {
        code: airport.code,
        name: airport.name,
        city: airport.city,
        state: airport.state,
        country: airport.country,
        latitude: airport.latitude,
        longitude: airport.longitude,
      },
      pois,
      search: {
        radiusKm: distance,
        minRating,
        type: requestedType,
      },
      count: pois.length,
    });
  } catch (error) {
    logger.error("Error fetching airport", { code: cleanCode, error: String(error) });

    return Response.json(
      {
        error: "Database error",
        message: "Failed to fetch airport data. Please try again later.",
      },
      { status: 500 }
    );
  }
}
