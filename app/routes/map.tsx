/**
 * Map Route - Interactive Google Maps Interface
 *
 * This route displays the main Google Maps interface for GA Eats.
 * Users can view restaurants and airports, get directions, and explore
 * locations using satellite view and street view.
 *
 * Features:
 * - Interactive map with satellite/hybrid view
 * - Restaurant and airport markers
 * - Click-to-get-directions functionality
 * - Multi-modal directions (walking, biking, transit, driving)
 * - Turn-by-turn navigation
 *
 * @module routes/map
 */

import type { Route } from "./+types/map";
import { lazy, Suspense } from "react";
import { prisma } from "~/utils/db.server";
import { findRestaurantsNearby, findAirportsNearby } from "~/utils/geospatial.server";
import type { POI } from "~/components/GoogleMapComponent";

// Lazy load the Google Maps component (client-side only)
const GoogleMapComponent = lazy(() => import("~/components/GoogleMapComponent"));

/**
 * Meta tags for the map page
 */
export function meta({}: Route.MetaArgs) {
  return [
    { title: "Map - GA Eats" },
    {
      name: "description",
      content:
        "Interactive map showing fly-in dining locations. Find restaurants near airports with directions.",
    },
  ];
}

/**
 * Loader function - fetches nearby restaurants and airports
 *
 * Query Parameters:
 * - lat (optional): Center latitude
 * - lng (optional): Center longitude
 * - radius (optional): Search radius in km (default: 50)
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);

  // Get coordinates from query params or use default (center of USA)
  const lat = parseFloat(url.searchParams.get("lat") || "39.8283");
  const lng = parseFloat(url.searchParams.get("lng") || "-98.5795");
  const radius = parseFloat(url.searchParams.get("radius") || "50");

  try {
    const db = prisma;

    // Fetch restaurants and airports in parallel
    const [restaurants, airports] = await Promise.all([
      findRestaurantsNearby(
        db,
        { latitude: lat, longitude: lng },
        radius,
        4.0, // Min rating
        50 // Limit
      ),
      findAirportsNearby(
        db,
        { latitude: lat, longitude: lng },
        radius * 2, // Wider radius for airports
        20 // Limit
      ),
    ]);

    // Transform to POI format
    const restaurantPOIs: POI[] = restaurants.map((r) => ({
      id: r.id,
      position: { lat: r.latitude, lng: r.longitude },
      title: r.name,
      type: "restaurant" as const,
      data: {
        ...r,
        // Ensure the required property exists so RestaurantWithDistance is compatible with Restaurant
        googlePlaceId: (r as any).googlePlaceId ?? (r as any).google_place_id ?? "",
      },
    }));

    const airportPOIs: POI[] = airports.map((a) => ({
      id: a.id,
      position: { lat: a.latitude, lng: a.longitude },
      title: `${a.code} - ${a.name}`,
      type: "airport" as const,
      data: a,
    }));

    return {
      pois: [...restaurantPOIs, ...airportPOIs],
      center: { lat, lng },
      restaurants: restaurants.length,
      airports: airports.length,
    };
  } catch (error) {
    console.error("Error loading map data:", error);

    // Return empty data on error
    return {
      pois: [],
      center: { lat, lng },
      restaurants: 0,
      airports: 0,
    };
  }
}

/**
 * Loading fallback component
 */
function MapFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-gray-100">
      <div className="text-center">
        <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600 mx-auto"></div>
        <p className="text-lg text-gray-600">Loading map...</p>
        <p className="text-sm text-gray-500 mt-2">
          Please ensure your Google Maps API key is configured
        </p>
      </div>
    </div>
  );
}

/**
 * Map Route Component
 * Renders the Google Maps interface with POIs
 */
export default function MapRoute({ loaderData }: Route.ComponentProps) {
  return (
    <Suspense fallback={<MapFallback />}>
      <GoogleMapComponent
        center={loaderData.center}
        zoom={8}
        pois={loaderData.pois}
      />
    </Suspense>
  );
}
