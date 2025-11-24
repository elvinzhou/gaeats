/**
 * API Route: Find Restaurants Nearby
 * GET /api/restaurants/nearby
 *
 * Returns restaurants within a specified radius of a geographic point.
 * Results are sorted by distance and filtered by minimum rating.
 *
 * Query Parameters:
 * - lat (required): Latitude of search point
 * - lng (required): Longitude of search point
 * - distance (optional): Search radius in kilometers (default: 5.0)
 * - minRating (optional): Minimum rating filter (default: 4.0)
 * - limit (optional): Maximum results to return (default: 20)
 *
 * Example:
 * GET /api/restaurants/nearby?lat=37.7749&lng=-122.4194&distance=5&minRating=4.5
 *
 * Response:
 * {
 *   "restaurants": [
 *     {
 *       "id": 1,
 *       "name": "The Flying Burger",
 *       "cuisine": "American",
 *       "rating": 4.5,
 *       "address": "123 Airport Rd",
 *       "distance": 1234.56,
 *       ...
 *     }
 *   ],
 *   "search": {
 *     "latitude": 37.7749,
 *     "longitude": -122.4194,
 *     "radiusKm": 5.0,
 *     "minRating": 4.5
 *   },
 *   "count": 10
 * }
 */

import { prisma } from "~/utils/db.server";
import { findRestaurantsNearby } from "~/utils/geospatial.server";

interface LoaderArgs {
  request: Request;
  context: { cloudflare: { env: Env } };
}

/**
 * Loader function - handles GET requests
 * Validates query parameters and returns restaurant data
 */
export async function loader({ request, context }: LoaderArgs) {
  // Parse query parameters from URL
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat") || "");
  const lng = parseFloat(url.searchParams.get("lng") || "");
  const distance = parseFloat(url.searchParams.get("distance") || "5.0");
  const minRating = parseFloat(url.searchParams.get("minRating") || "4.0");
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);

  // Validate required parameters
  if (isNaN(lat) || isNaN(lng)) {
    return Response.json(
      {
        error: "Invalid parameters",
        message: "Both 'lat' and 'lng' query parameters are required and must be valid numbers",
        example: "/api/restaurants/nearby?lat=37.7749&lng=-122.4194&distance=5",
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

  if (distance <= 0 || distance > 500) {
    return Response.json(
      {
        error: "Invalid distance",
        message: "Distance must be between 0 and 500 kilometers",
      },
      { status: 400 }
    );
  }

  try {
    // Get singleton Prisma client with Accelerate extension
    const db = prisma;

    // Find restaurants using PostGIS geospatial queries
    const restaurants = await findRestaurantsNearby(
      db,
      { latitude: lat, longitude: lng },
      distance,
      minRating,
      limit
    );

    // Return JSON response with search metadata
    return Response.json({
      restaurants,
      search: {
        latitude: lat,
        longitude: lng,
        radiusKm: distance,
        minRating,
        limit,
      },
      count: restaurants.length,
    });
  } catch (error) {
    // Log error and return 500 response
    console.error("Error fetching restaurants:", error);

    return Response.json(
      {
        error: "Database error",
        message: "Failed to fetch restaurants. Please try again later.",
      },
      { status: 500 }
    );
  }
}
