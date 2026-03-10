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
import { Link, useSearchParams } from "react-router";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  InfoWindow,
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
  type: "restaurant" | "attraction" | "airport";
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
  /** Optional POI to preselect on first render */
  initialSelectedPoi?: { id: number; type: POI["type"] } | null;
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
  const [showRestaurants, setShowRestaurants] = useState(true);
  const [showAttractions, setShowAttractions] = useState(true);
  const [showAirports, setShowAirports] = useState(true);

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

  useEffect(() => {
    if (!initialSelectedPoi) return;

    const matchingPoi = pois.find(
      (poi) =>
        poi.id === initialSelectedPoi.id &&
        poi.type === initialSelectedPoi.type,
    );

    if (matchingPoi) {
      setSelectedPOI(matchingPoi);
    }
  }, [initialSelectedPoi, pois]);

  const visiblePois = pois.filter((poi) => {
    if (poi.type === "restaurant") return showRestaurants;
    if (poi.type === "attraction") return showAttractions;
    return showAirports;
  });

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
            {visiblePois.map((poi) => (
              <AdvancedMarker
                key={poi.id}
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
                      ⭐ {(hoveredPOI.data as Poi).externalRating ?? "N/A"}/5.0
                    </p>
                  )}
                  {hoveredPOI.type === "airport" && (
                    <Link
                      to={`/airports/${(hoveredPOI.data as Airport).code}`}
                      className="mt-2 inline-block text-sm font-medium text-blue-700 hover:text-blue-900"
                    >
                      Open airport page
                    </Link>
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

          <LayerControls
            showRestaurants={showRestaurants}
            showAttractions={showAttractions}
            showAirports={showAirports}
            onToggleRestaurants={() => setShowRestaurants((value) => !value)}
            onToggleAttractions={() => setShowAttractions((value) => !value)}
            onToggleAirports={() => setShowAirports((value) => !value)}
          />

          {selectedPOI?.type === "airport" && (
            <div className="absolute bottom-6 right-6 z-10 max-w-sm rounded-2xl bg-white p-4 shadow-lg ring-1 ring-stone-200">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Airport Detail
              </div>
              <h3 className="mt-2 text-lg font-semibold text-stone-900">
                {selectedPOI.title}
              </h3>
              <p className="mt-1 text-sm text-stone-600">
                Open the airport page for nearby restaurants, attractions, and
                access notes.
              </p>
              <Link
                to={`/airports/${(selectedPOI.data as Airport).code}`}
                className="mt-3 inline-flex rounded-full bg-stone-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800"
              >
                View airport page
              </Link>
            </div>
          )}

          {/* Legend */}
          <div className="absolute bottom-6 left-6 rounded-lg bg-white p-4 shadow-lg">
            <h3 className="mb-2 font-semibold">Legend</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-full bg-[#FF6B6B]"></div>
                <span className="text-sm">Restaurants</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-full bg-[#F4A261]"></div>
                <span className="text-sm">Attractions</span>
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

function getMarkerColors(type: POI["type"]) {
  switch (type) {
    case "restaurant":
      return { background: "#FF6B6B", border: "#C92A2A" };
    case "attraction":
      return { background: "#F4A261", border: "#C46A24" };
    case "airport":
      return { background: "#4ECDC4", border: "#0CA39A" };
  }
}

function LayerControls({
  showRestaurants,
  showAttractions,
  showAirports,
  onToggleRestaurants,
  onToggleAttractions,
  onToggleAirports,
}: {
  showRestaurants: boolean;
  showAttractions: boolean;
  showAirports: boolean;
  onToggleRestaurants: () => void;
  onToggleAttractions: () => void;
  onToggleAirports: () => void;
}) {
  return (
    <div className="absolute left-4 top-4 z-10 rounded-lg bg-white p-2 shadow-lg">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Layers
      </div>
      <div className="flex flex-col gap-2">
        <LayerToggle
          label="Restaurants"
          active={showRestaurants}
          colorClass="bg-[#FF6B6B]"
          onClick={onToggleRestaurants}
        />
        <LayerToggle
          label="Attractions"
          active={showAttractions}
          colorClass="bg-[#F4A261]"
          onClick={onToggleAttractions}
        />
        <LayerToggle
          label="Airports"
          active={showAirports}
          colorClass="bg-[#4ECDC4]"
          onClick={onToggleAirports}
        />
      </div>
    </div>
  );
}

function LayerToggle({
  label,
  active,
  colorClass,
  onClick,
}: {
  label: string;
  active: boolean;
  colorClass: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
        active ? "bg-gray-100 text-gray-900" : "bg-white text-gray-500"
      }`}
    >
      <span className={`h-3 w-3 rounded-full ${colorClass}`}></span>
      <span>{label}</span>
    </button>
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
