/**
 * API Route: Find Airports Nearby
 * GET /api/airports/nearby
 *
 * Returns airports within a specified radius of a geographic point.
 * Results are sorted by distance from the search point.
 *
 * Query Parameters:
 * - lat (required): Latitude of search point
 * - lng (required): Longitude of search point
 * - distance (optional): Search radius in kilometers (default: 50.0)
 * - limit (optional): Maximum results to return (default: 20)
 *
 * Example:
 * GET /api/airports/nearby?lat=37.7749&lng=-122.4194&distance=100
 *
 * Response:
 * {
 *   "airports": [
 *     {
 *       "code": "KSFO",
 *       "name": "San Francisco International Airport",
 *       "city": "San Francisco",
 *       "distance": 12345.67,
 *       ...
 *     }
 *   ],
 *   "search": {
 *     "latitude": 37.7749,
 *     "longitude": -122.4194,
 *     "radiusKm": 100.0
 *   },
 *   "count": 5
 * }
 */

import { prisma } from "~/utils/db.server";
import { findAirportsNearby } from "~/utils/geospatial.server";

interface LoaderArgs {
  request: Request;
  context: { cloudflare: { env: Env } };
}

/**
 * Loader function - handles GET requests
 * Validates query parameters and returns airport data
 */
export async function loader({ request, context }: LoaderArgs) {
  // Parse query parameters from URL
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat") || "");
  const lng = parseFloat(url.searchParams.get("lng") || "");
  const distance = parseFloat(url.searchParams.get("distance") || "50.0");
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);

  // Validate required parameters
  if (isNaN(lat) || isNaN(lng)) {
    return Response.json(
      {
        error: "Invalid parameters",
        message: "Both 'lat' and 'lng' query parameters are required and must be valid numbers",
        example: "/api/airports/nearby?lat=37.7749&lng=-122.4194&distance=50",
      },
      { status: 400 }
    );
  }

  // Validate parameter ranges
  if (lat < -90 || lat > 90) {
    return Response.json(
      {
        error: "Invalid latitude",
        message: "Latitude must be between -90 and 90",
      },
      { status: 400 }
    );
  }

  if (lng < -180 || lng > 180) {
    return Response.json(
      {
        error: "Invalid longitude",
        message: "Longitude must be between -180 and 180",
      },
      { status: 400 }
    );
  }

  if (distance <= 0 || distance > 1000) {
    return Response.json(
      {
        error: "Invalid distance",
        message: "Distance must be between 0 and 1000 kilometers",
      },
      { status: 400 }
    );
  }

  try {
    // Get singleton Prisma client with Accelerate extension
    const db = prisma;

    // Find airports using PostGIS geospatial queries
    const airports = await findAirportsNearby(
      db,
      { latitude: lat, longitude: lng },
      distance,
      limit
    );

    // Return JSON response with search metadata
    return Response.json({
      airports,
      search: {
        latitude: lat,
        longitude: lng,
        radiusKm: distance,
        limit,
      },
      count: airports.length,
    });
  } catch (error) {
    // Log error and return 500 response
    console.error("Error fetching airports:", error);

    return Response.json(
      {
        error: "Database error",
        message: "Failed to fetch airports. Please try again later.",
      },
      { status: 500 }
    );
  }
}
