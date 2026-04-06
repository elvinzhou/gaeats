/**
 * API Route: Find POIs Nearby
 * GET /api/pois/nearby
 *
 * Returns restaurants or attractions within a specified radius of a geographic point.
 * Results are sorted by distance and filtered by minimum external rating.
 */

import { createPrisma } from "~/utils/db.server";
import { findPoisNearby } from "~/utils/geospatial.server";
import { logger } from "~/utils/logger.server";

interface LoaderArgs {
  request: Request;
  context: { cloudflare: { env: Env } };
}

export async function loader({ request, context }: LoaderArgs) {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat") || "");
  const lng = parseFloat(url.searchParams.get("lng") || "");
  const distance = parseFloat(url.searchParams.get("distance") || "5.0");
  const minRating = parseFloat(url.searchParams.get("minRating") || "4.0");
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);
  const requestedType = url.searchParams.get("type") || "RESTAURANT";

  if (isNaN(lat) || isNaN(lng)) {
    return Response.json(
      {
        error: "Invalid parameters",
        message: "Both 'lat' and 'lng' query parameters are required and must be valid numbers",
        example:
          "/api/pois/nearby?lat=37.7749&lng=-122.4194&distance=5&type=RESTAURANT",
      },
      { status: 400 }
    );
  }

  if (lat < -90 || lat > 90) {
    return Response.json(
      { error: "Invalid latitude", message: "Latitude must be between -90 and 90" },
      { status: 400 }
    );
  }

  if (lng < -180 || lng > 180) {
    return Response.json(
      { error: "Invalid longitude", message: "Longitude must be between -180 and 180" },
      { status: 400 }
    );
  }

  if (distance <= 0 || distance > 500) {
    return Response.json(
      { error: "Invalid distance", message: "Distance must be between 0 and 500 kilometers" },
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
    const pois = await findPoisNearby(
      createPrisma(context.cloudflare.env.DATABASE_URL),
      { latitude: lat, longitude: lng },
      requestedType,
      distance,
      minRating,
      limit
    );

    return Response.json({
      pois,
      search: {
        latitude: lat,
        longitude: lng,
        radiusKm: distance,
        minRating,
        limit,
        type: requestedType,
      },
      count: pois.length,
    });
  } catch (error) {
    logger.error("Error fetching POIs", { lat, lng, distance, type: requestedType, error: String(error) });

    return Response.json(
      {
        error: "Database error",
        message: "Failed to fetch POIs. Please try again later.",
      },
      { status: 500 }
    );
  }
}
