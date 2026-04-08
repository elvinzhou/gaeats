/**
 * Google Maps Component for GA Eats
 *
 * This component displays an interactive Google Map with the following features:
 * - Satellite, roadmap, and hybrid view options
 * - Markers for restaurants and airports
 * - Click handlers to show directions
 * - Directions rendering with multiple travel modes
 * - Street view integration
 * - Dynamic airport loading as the map is panned/zoomed
 *
 * Uses @vis.gl/react-google-maps for React integration
 *
 * @module GoogleMapComponent
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useMap,
} from "@vis.gl/react-google-maps";
import { DirectionsRenderer } from "./DirectionsRenderer";
import { DirectionsPanel } from "./DirectionsPanel";
import type { Poi, Airport } from "~/types/models";

/**
 * Point of Interest type
 * Represents either a restaurant or airport on the map
 */
export interface POI {
  id: number;
  position: { lat: number; lng: number };
  title: string;
  type: "restaurant" | "airport" | "attraction";
  data: Poi | Airport;
}

/**
 * Map type options
 */
type MapTypeId = "roadmap" | "satellite" | "hybrid" | "terrain";

/**
 * Props for GoogleMapComponent
 */
interface GoogleMapComponentProps {
  /** Initial center point for the map */
  center?: { lat: number; lng: number };
  /** Initial zoom level */
  zoom?: number;
  /** Array of points of interest to display */
  pois: POI[];
  /** Initial selected POI */
  initialSelectedPoi?: { id: number; type: string } | null;
}

/**
 * Inner component that uses useMap() to:
 *   1. Re-centre/re-zoom when the parent navigates to a new location.
 *   2. Listen for the map's `idle` event and fetch nearby airports for the
 *      current viewport, so markers stay populated as the user pans/zooms.
 */
function MapController({
  center,
  zoom,
  onAirportsFetched,
}: {
  center: { lat: number; lng: number };
  zoom: number;
  onAirportsFetched: (airports: POI[]) => void;
}) {
  const map = useMap();
  const prevCenterRef = useRef(center);
  // Track the last viewport we fetched so we skip redundant requests.
  const lastFetchRef = useRef<{ lat: number; lng: number; radius: number } | null>(null);

  // Programmatically re-centre when the user navigates to a new airport/location.
  useEffect(() => {
    if (!map) return;
    const prev = prevCenterRef.current;
    if (prev.lat !== center.lat || prev.lng !== center.lng) {
      map.panTo(center);
      map.setZoom(zoom);
      prevCenterRef.current = center;
    }
  }, [map, center, zoom]);

  // Fetch airports for the current viewport whenever the map settles.
  useEffect(() => {
    if (!map) return;

    const listener = map.addListener("idle", async () => {
      const bounds = map.getBounds();
      const currentZoom = map.getZoom() ?? 0;
      // Don't bother loading at very low zoom levels – too wide an area.
      if (!bounds || currentZoom < 6) return;

      const mapCenter = map.getCenter()!.toJSON();
      const ne = bounds.getNorthEast().toJSON();

      // Approximate radius from centre to NE corner in km.
      const latDiff = Math.abs(ne.lat - mapCenter.lat);
      const lngDiff = Math.abs(ne.lng - mapCenter.lng);
      const radiusKm = Math.min(Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111, 500);

      // Skip if we already fetched this viewport (moved < 30 % of radius).
      if (lastFetchRef.current) {
        const { lat, lng, radius } = lastFetchRef.current;
        const movedKm =
          Math.sqrt(
            (lat - mapCenter.lat) ** 2 + (lng - mapCenter.lng) ** 2
          ) * 111;
        if (movedKm < radius * 0.3) return;
      }

      lastFetchRef.current = { lat: mapCenter.lat, lng: mapCenter.lng, radius: radiusKm };

      try {
        const res = await fetch(
          `/api/airports/nearby?lat=${mapCenter.lat}&lng=${mapCenter.lng}&distance=${Math.ceil(radiusKm)}&limit=80`
        );
        if (!res.ok) return;
        const data = (await res.json()) as { airports: (Airport & { distance: number })[] };

        const newPOIs: POI[] = data.airports.map((a) => ({
          id: a.id,
          position: { lat: a.latitude, lng: a.longitude },
          title: `${a.code} - ${a.name}`,
          type: "airport" as const,
          data: a,
        }));

        onAirportsFetched(newPOIs);
      } catch {
        // Network errors are non-fatal; existing markers stay visible.
      }
    });

    return () => listener.remove();
  }, [map, onAirportsFetched]);

  return null;
}

/**
 * Main Google Maps component
 * Displays map with markers and handles user interactions
 */
export default function GoogleMapComponent({
  center = { lat: 39.8283, lng: -98.5795 }, // Center of USA
  zoom = 5,
  pois,
  initialSelectedPoi = null,
}: GoogleMapComponentProps) {
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null);
  const [mapTypeId, setMapTypeId] = useState<MapTypeId>("roadmap");
  const [hoveredPOI, setHoveredPOI] = useState<POI | null>(null);
  const [searchParams] = useSearchParams();

  // Local POI state: seeded from the server, augmented by viewport fetches.
  const [localPois, setLocalPois] = useState<POI[]>(pois);

  // When the loader delivers fresh data (e.g. after airport search navigation),
  // replace local state and let MapController trigger a viewport fetch.
  useEffect(() => {
    setLocalPois(pois);
  }, [pois]);

  // Merge newly fetched airport markers, deduplicating by type+id.
  const handleAirportsFetched = useCallback((incoming: POI[]) => {
    setLocalPois((prev) => {
      const existingKeys = new Set(prev.map((p) => `${p.type}-${p.id}`));
      const toAdd = incoming.filter((a) => !existingKeys.has(`airport-${a.id}`));
      return toAdd.length === 0 ? prev : [...prev, ...toAdd];
    });
  }, []);

  const getMarkerColors = (type: string) => {
    switch (type) {
      case "restaurant":
        return { background: "#FF6B6B", border: "#D64545" };
      case "airport":
        return { background: "#4ECDC4", border: "#399E97" };
      case "attraction":
        return { background: "#FFD93D", border: "#C9A71A" };
      default:
        return { background: "#4D96FF", border: "#2E76E6" };
    }
  };

  // Get API key from environment variable
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  // Warn if API key is missing
  useEffect(() => {
    if (!apiKey || apiKey === "YOUR_GOOGLE_MAPS_API_KEY_HERE") {
      console.error(
        "Google Maps API key is missing! Please set VITE_GOOGLE_MAPS_API_KEY in your .env file",
      );
    }
  }, [apiKey]);

  return (
    <APIProvider apiKey={apiKey || ""}>
      <div className="flex h-screen w-full">
        {/* Map Container */}
        <div className="relative flex-1">
          <Map
            defaultCenter={center}
            defaultZoom={zoom}
            mapId="ga-eats-map" // Required for AdvancedMarker
            gestureHandling="greedy"
            disableDefaultUI={false}
            mapTypeId={mapTypeId}
            className="h-full w-full"
          >
            {/* Re-centres map on navigation & fetches airports on viewport change */}
            <MapController
              center={center}
              zoom={zoom}
              onAirportsFetched={handleAirportsFetched}
            />

            {/* Render POI Markers */}
            {localPois.map((poi) => (
              <AdvancedMarker
                key={`${poi.type}-${poi.id}`}
                position={poi.position}
                onClick={() => setSelectedPOI(poi)}
                onMouseEnter={() => setHoveredPOI(poi)}
                onMouseLeave={() => setHoveredPOI(null)}
                title={poi.title}
              >
                <Pin
                  background={getMarkerColors(poi.type).background}
                  borderColor={getMarkerColors(poi.type).border}
                  glyphColor="white"
                  scale={hoveredPOI?.id === poi.id ? 1.2 : 1}
                />
              </AdvancedMarker>
            ))}

            {/* Info Window on Hover */}
            {hoveredPOI && (
              <InfoWindow
                position={hoveredPOI.position}
                onCloseClick={() => setHoveredPOI(null)}
              >
                <div className="p-2">
                  <h3 className="font-semibold">{hoveredPOI.title}</h3>
                  {hoveredPOI.type !== "airport" && (
                    <p className="text-sm text-gray-600">
                      ⭐ {(hoveredPOI.data as Poi).externalRating}/5.0
                    </p>
                  )}
                </div>
              </InfoWindow>
            )}

            {/* Directions Renderer */}
            {selectedPOI && (
              <DirectionsRenderer
                destination={selectedPOI.position}
                travelMode={(searchParams.get("mode") as any) || "DRIVING"}
              />
            )}
          </Map>

          {/* Map Type Controls */}
          <MapTypeControls
            mapTypeId={mapTypeId}
            onMapTypeChange={setMapTypeId}
          />

          {/* Legend */}
          <div className="absolute bottom-6 left-6 rounded-lg bg-white p-4 shadow-lg">
            <h3 className="mb-2 font-semibold">Legend</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-full bg-[#FF6B6B]"></div>
                <span className="text-sm">Restaurants</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-full bg-[#4ECDC4]"></div>
                <span className="text-sm">Airports</span>
              </div>
            </div>
          </div>
        </div>

        {/* Directions Panel */}
        {selectedPOI && (
          <DirectionsPanel
            destination={selectedPOI}
            onClose={() => setSelectedPOI(null)}
          />
        )}
      </div>
    </APIProvider>
  );
}

/**
 * Map Type Control Buttons
 * Allows switching between roadmap, satellite, and hybrid views
 */
function MapTypeControls({
  mapTypeId,
  onMapTypeChange,
}: {
  mapTypeId: MapTypeId;
  onMapTypeChange: (type: MapTypeId) => void;
}) {
  const buttonClass = (type: MapTypeId) =>
    `px-4 py-2 rounded-md transition-colors ${
      mapTypeId === type
        ? "bg-blue-600 text-white"
        : "bg-white text-gray-700 hover:bg-gray-100"
    }`;

  return (
    <div className="absolute right-4 top-4 z-10 flex gap-2 rounded-lg bg-white p-2 shadow-lg">
      <button
        onClick={() => onMapTypeChange("roadmap")}
        className={buttonClass("roadmap")}
        title="Roadmap view"
      >
        🗺️ Map
      </button>
      <button
        onClick={() => onMapTypeChange("satellite")}
        className={buttonClass("satellite")}
        title="Satellite view"
      >
        🛰️ Satellite
      </button>
      <button
        onClick={() => onMapTypeChange("hybrid")}
        className={buttonClass("hybrid")}
        title="Hybrid view (satellite + labels)"
      >
        🌐 Hybrid
      </button>
    </div>
  );
}
