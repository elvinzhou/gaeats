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
 * - Airport search box that zooms to selected airport
 *
 * @module routes/map
 */

import type { Route } from "./+types/map";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate, useFetcher } from "react-router";
import { createPrisma } from "~/utils/db.server";
import {
  findAirportsNearby,
  findAttractionsNearby,
  findRestaurantsNearby,
} from "~/utils/geospatial.server";
import type { POI } from "~/components/GoogleMapComponent";

// Lazy load the Google Maps component (client-side only)
const GoogleMapComponent = lazy(() => import("~/components/GoogleMapComponent"));

interface AirportSearchResult {
  code: string;
  name: string;
  city: string;
  state: string | null;
  latitude: number;
  longitude: number;
}

/**
 * Meta tags for the map page
 */
export function meta({}: Route.MetaArgs) {
  return [
    { title: "Map - GA Eats" },
    {
      name: "description",
      content:
        "Interactive map showing general aviation airports and nearby points of interest with directions.",
    },
  ];
}

/**
 * Loader function - fetches nearby POIs and airports
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
  const selectedPoiId = Number.parseInt(url.searchParams.get("poiId") || "", 10);
  const selectedPoiType = url.searchParams.get("poiType");

  try {
    const db = createPrisma(context.cloudflare.env.DATABASE_URL);

    // Fetch nearby POIs and airports in parallel
    const [restaurants, attractions, airports] = await Promise.all([
      findRestaurantsNearby(
        db,
        { latitude: lat, longitude: lng },
        radius,
        4.0, // Min rating
        50 // Limit
      ),
      findAttractionsNearby(
        db,
        { latitude: lat, longitude: lng },
        radius,
        4.0,
        50
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
      data: r,
    }));

    const attractionPOIs: POI[] = (attractions as any).map((poi: any) => ({
      id: poi.id,
      position: { lat: poi.latitude, lng: poi.longitude },
      title: poi.name,
      type: "attraction" as const,
      data: poi,
    }));

    const airportPOIs: POI[] = airports.map((a) => ({
      id: a.id,
      position: { lat: a.latitude, lng: a.longitude },
      title: `${a.code} - ${a.name}`,
      type: "airport" as const,
      data: a,
    }));

    return {
      pois: [...restaurantPOIs, ...attractionPOIs, ...airportPOIs],
      center: { lat, lng },
      initialSelectedPoi:
        Number.isNaN(selectedPoiId) || !selectedPoiType
          ? null
          : {
              id: selectedPoiId,
              type:
                selectedPoiType === "attraction"
                  ? ("attraction" as const)
                  : selectedPoiType === "airport"
                    ? ("airport" as const)
                    : ("restaurant" as const),
            },
      restaurants: restaurants.length,
      attractions: attractions.length,
      airports: airports.length,
    };
  } catch (error) {
    console.error("Error loading map data:", error);

    // Return empty data on error
    return {
      pois: [],
      center: { lat, lng },
      initialSelectedPoi: null,
      restaurants: 0,
      attractions: 0,
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
 * Airport search box overlay, positioned over the map.
 * Uses a fetcher to query /api/airports/search without navigating.
 * On selection, navigates to /map?lat=X&lng=Y to re-center the map.
 */
function AirportSearchBox() {
  const navigate = useNavigate();
  const fetcher = useFetcher<{ results: AirportSearchResult[] }>();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = fetcher.data?.results ?? [];

  // Query as user types
  useEffect(() => {
    if (query.length < 2) {
      setOpen(false);
      return;
    }
    fetcher.load(`/api/airports/search?q=${encodeURIComponent(query)}`);
    setOpen(true);
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function selectAirport(airport: AirportSearchResult) {
    setQuery(airport.code);
    setOpen(false);
    navigate(`/map?lat=${airport.latitude}&lng=${airport.longitude}&radius=50`);
  }

  return (
    <div
      ref={containerRef}
      className="absolute top-4 left-1/2 -translate-x-1/2 z-10 w-full max-w-sm px-4"
    >
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 2 && setOpen(true)}
          placeholder="Search airport code, name, or city…"
          className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 pr-10 text-sm text-gray-900 shadow-lg outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        {fetcher.state === "loading" && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="mt-1 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
          {results.map((airport) => (
            <li key={airport.code}>
              <button
                type="button"
                onClick={() => selectAirport(airport)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-gray-50"
              >
                <span>
                  <span className="font-semibold text-gray-900">{airport.code}</span>
                  <span className="ml-2 text-gray-600">{airport.name}</span>
                </span>
                <span className="ml-4 shrink-0 text-xs text-gray-400">
                  {airport.city}{airport.state ? `, ${airport.state}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && query.length >= 2 && fetcher.state === "idle" && results.length === 0 && (
        <div className="mt-1 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500 shadow-xl">
          No airports found for "{query}"
        </div>
      )}
    </div>
  );
}

/**
 * Map Route Component
 * Renders the Google Maps interface with POIs and airport search overlay
 */
export default function MapRoute({ loaderData }: Route.ComponentProps) {
  return (
    <div className="relative h-screen w-full">
      <AirportSearchBox />
      <Suspense fallback={<MapFallback />}>
        <GoogleMapComponent
          center={loaderData.center}
          zoom={8}
          pois={loaderData.pois}
          initialSelectedPoi={loaderData.initialSelectedPoi}
        />
      </Suspense>
    </div>
  );
}
