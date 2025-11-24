/**
 * Google Maps Component for GA Eats
 *
 * This component displays an interactive Google Map with the following features:
 * - Satellite, roadmap, and hybrid view options
 * - Markers for restaurants and airports
 * - Click handlers to show directions
 * - Directions rendering with multiple travel modes
 * - Street view integration
 *
 * Uses @vis.gl/react-google-maps for React integration
 *
 * @module GoogleMapComponent
 */

import { useState, useEffect } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  InfoWindow,
} from "@vis.gl/react-google-maps";
import { DirectionsRenderer } from "./DirectionsRenderer";
import { DirectionsPanel } from "./DirectionsPanel";
import type { Restaurant, Airport } from "~/types/models";

/**
 * Point of Interest type
 * Represents either a restaurant or airport on the map
 */
export interface POI {
  id: number;
  position: { lat: number; lng: number };
  title: string;
  type: "restaurant" | "airport";
  data: Restaurant | Airport;
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
}

/**
 * Main Google Maps component
 * Displays map with markers and handles user interactions
 */
export default function GoogleMapComponent({
  center = { lat: 39.8283, lng: -98.5795 }, // Center of USA
  zoom = 5,
  pois,
}: GoogleMapComponentProps) {
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null);
  const [mapTypeId, setMapTypeId] = useState<MapTypeId>("roadmap");
  const [hoveredPOI, setHoveredPOI] = useState<POI | null>(null);

  // Get API key from environment variable
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  // Warn if API key is missing
  useEffect(() => {
    if (!apiKey || apiKey === "YOUR_GOOGLE_MAPS_API_KEY_HERE") {
      console.error(
        "Google Maps API key is missing! Please set VITE_GOOGLE_MAPS_API_KEY in your .env file"
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
            {/* Render POI Markers */}
            {pois.map((poi) => (
              <AdvancedMarker
                key={poi.id}
                position={poi.position}
                onClick={() => setSelectedPOI(poi)}
                onMouseEnter={() => setHoveredPOI(poi)}
                onMouseLeave={() => setHoveredPOI(null)}
                title={poi.title}
              >
                <Pin
                  background={poi.type === "restaurant" ? "#FF6B6B" : "#4ECDC4"}
                  borderColor={
                    poi.type === "restaurant" ? "#C92A2A" : "#0CA39A"
                  }
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
                  {hoveredPOI.type === "restaurant" && (
                    <p className="text-sm text-gray-600">
                      ⭐ {(hoveredPOI.data as Restaurant).rating}/5.0
                    </p>
                  )}
                </div>
              </InfoWindow>
            )}

            {/* Directions Renderer */}
            {selectedPOI && (
              <DirectionsRenderer destination={selectedPOI.position} />
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
