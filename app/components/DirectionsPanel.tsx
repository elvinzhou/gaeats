/**
 * Directions Panel Component
 *
 * Side panel that displays turn-by-turn directions, route information,
 * and travel mode selection. Updates in real-time when travel mode changes.
 *
 * Features:
 * - Multiple travel modes (driving, walking, bicycling, transit)
 * - Alternative route display
 * - Turn-by-turn directions
 * - Distance and duration estimates
 * - Traffic-aware timing (when available)
 *
 * @module DirectionsPanel
 */

import { useState, useEffect } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import type { POI } from "./GoogleMapComponent";
import type { TravelMode } from "./DirectionsRenderer";

/**
 * Props for DirectionsPanel component
 */
interface DirectionsPanelProps {
  /** Selected destination POI */
  destination: POI;
  /** Callback when panel is closed */
  onClose: () => void;
  /** Optional callback when travel mode changes */
  onTravelModeChange?: (mode: TravelMode) => void;
}

/**
 * DirectionsPanel Component
 *
 * Displays a side panel with route details and travel mode selection
 */
export function DirectionsPanel({
  destination,
  onClose,
  onTravelModeChange,
}: DirectionsPanelProps) {
  const routesLibrary = useMapsLibrary("routes");
  const [travelMode, setTravelMode] = useState<TravelMode>("DRIVING");
  const [routes, setRoutes] = useState<google.maps.DirectionsRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  // Get user's current location
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.error("Error getting user location:", error);
          // Fallback location (center of USA)
          setUserLocation({ lat: 39.8283, lng: -98.5795 });
        }
      );
    }
  }, []);

  // Fetch directions when travel mode or destination changes
  useEffect(() => {
    if (!routesLibrary || !userLocation) return;

    setLoading(true);
    const service = new routesLibrary.DirectionsService();

    service.route(
      {
        origin: userLocation,
        destination: destination.position,
        travelMode: google.maps.TravelMode[travelMode],
        provideRouteAlternatives: true,
      },
      (response, status) => {
        setLoading(false);
        if (status === "OK" && response) {
          setRoutes(response.routes);
          setSelectedRouteIndex(0);
        } else {
          console.error("Directions request failed:", status);
          setRoutes([]);
        }
      }
    );
  }, [routesLibrary, destination, travelMode, userLocation]);

  // Handle travel mode change
  const handleTravelModeChange = (mode: TravelMode) => {
    setTravelMode(mode);
    onTravelModeChange?.(mode);
  };

  return (
    <div className="h-full w-96 overflow-y-auto bg-white shadow-xl">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white p-4">
        <div>
          <h2 className="text-xl font-semibold">Directions</h2>
          <p className="text-sm text-gray-600">{destination.title}</p>
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-2 hover:bg-gray-100 transition-colors"
          title="Close directions"
        >
          <span className="text-2xl">×</span>
        </button>
      </div>

      <div className="p-4">
        {/* Travel Mode Selector */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-semibold text-gray-700">
            Travel Mode
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(["DRIVING", "WALKING", "BICYCLING", "TRANSIT"] as TravelMode[]).map(
              (mode) => (
                <button
                  key={mode}
                  onClick={() => handleTravelModeChange(mode)}
                  className={`flex flex-col items-center gap-1 rounded-lg border-2 p-3 transition-all ${
                    travelMode === mode
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  <span className="text-2xl">{getModeIcon(mode)}</span>
                  <span className="text-xs font-medium capitalize">
                    {mode.toLowerCase()}
                  </span>
                </button>
              )
            )}
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="mb-2 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600 mx-auto"></div>
              <p className="text-sm text-gray-600">Loading directions...</p>
            </div>
          </div>
        )}

        {/* Routes List */}
        {!loading && routes.length > 0 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900">
              Available Routes ({routes.length})
            </h3>

            {routes.map((route, index) => (
              <div
                key={index}
                onClick={() => setSelectedRouteIndex(index)}
                className={`cursor-pointer rounded-lg border-2 p-4 transition-all ${
                  selectedRouteIndex === index
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                {/* Route Summary */}
                <h4 className="mb-2 font-medium text-gray-900">
                  {route.summary || `Route ${index + 1}`}
                </h4>

                <div className="space-y-1 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">📏 Distance:</span>
                    <span>{route.legs[0].distance?.text}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">⏱️ Duration:</span>
                    <span>{route.legs[0].duration?.text}</span>
                  </div>
                  {route.legs[0].duration_in_traffic && (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">🚦 In Traffic:</span>
                      <span>{route.legs[0].duration_in_traffic.text}</span>
                    </div>
                  )}
                </div>

                {/* Turn-by-Turn Directions (for selected route) */}
                {selectedRouteIndex === index && (
                  <div className="mt-4 border-t pt-4">
                    <h5 className="mb-3 font-semibold text-gray-900">
                      Turn-by-Turn Directions
                    </h5>
                    <div className="space-y-3">
                      {route.legs[0].steps.map((step, stepIndex) => (
                        <div
                          key={stepIndex}
                          className="flex gap-3 pb-3 border-b border-gray-100 last:border-0"
                        >
                          {/* Step Number */}
                          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                            {stepIndex + 1}
                          </div>

                          {/* Step Details */}
                          <div className="flex-1">
                            <div
                              dangerouslySetInnerHTML={{
                                __html: step.instructions,
                              }}
                              className="mb-1 text-sm text-gray-900"
                            />
                            <div className="text-xs text-gray-500">
                              {step.distance?.text} • {step.duration?.text}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* No Routes Found */}
        {!loading && routes.length === 0 && userLocation && (
          <div className="rounded-lg bg-yellow-50 p-4 text-center">
            <p className="text-sm text-yellow-800">
              No routes found for this travel mode. Try a different mode or check the destination.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Get emoji icon for travel mode
 */
function getModeIcon(mode: TravelMode): string {
  const icons: Record<TravelMode, string> = {
    DRIVING: "🚗",
    WALKING: "🚶",
    BICYCLING: "🚴",
    TRANSIT: "🚌",
  };
  return icons[mode];
}
