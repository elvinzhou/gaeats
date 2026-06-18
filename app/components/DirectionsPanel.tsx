import { useState, useEffect } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { getMarkerColor } from "~/utils/markerColors";
import type { POI } from "./GoogleMapComponent";
import type { Airport } from "~/types/models";
import type { TravelMode } from "./DirectionsRenderer";

interface DirectionsPanelProps {
  destination: POI;
  originAirport: Airport;
  imperial: boolean;
  onClose: () => void;
}

function sanitizeInstructions(html: string): string {
  return html
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "")
    .replace(/<(?!\/?(?:b|wbr|div)(?:\s|\/?>))[^>]*>/gi, "");
}

const MODE_ICONS: Record<TravelMode, string> = {
  DRIVING: "🚗",
  WALKING: "🚶",
  BICYCLING: "🚴",
  TRANSIT: "🚌",
};

function travelBadgeLabel(poi: POI): string | null {
  if (poi.type !== "accessible") return null;
  const d = poi.data as any;
  if (d.preferredMode === "WALKING" && d.walkingMinutes)
    return `🚶 ${d.walkingMinutes} min walk`;
  if (d.preferredMode === "BIKING" && d.bikingMinutes)
    return `🚲 ${d.bikingMinutes} min bike`;
  if (d.preferredMode === "TRANSIT" && d.transitMinutes)
    return `🚌 ${d.transitMinutes} min transit`;
  return null;
}

export function DirectionsPanel({ destination, originAirport, imperial, onClose }: DirectionsPanelProps) {
  const routesLibrary = useMapsLibrary("routes");
  const [travelMode, setTravelMode] = useState<TravelMode>("DRIVING");
  const [routes, setRoutes] = useState<google.maps.DirectionsRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);

  const effectiveOrigin = {
    lat: originAirport.rampLatitude ?? originAirport.latitude,
    lng: originAirport.rampLongitude ?? originAirport.longitude,
  };
  const usingRamp = originAirport.rampLatitude != null;

  useEffect(() => {
    if (!routesLibrary) return;
    setLoading(true);
    setRoutes([]);
    setSelectedRouteIndex(0);
    const service = new routesLibrary.DirectionsService();
    service.route(
      {
        origin: effectiveOrigin,
        destination: destination.position,
        travelMode: google.maps.TravelMode[travelMode],
        unitSystem: imperial
          ? google.maps.UnitSystem.IMPERIAL
          : google.maps.UnitSystem.METRIC,
        provideRouteAlternatives: true,
      },
      (response, status) => {
        setLoading(false);
        if (status === "OK" && response) {
          setRoutes(response.routes);
        } else {
          setRoutes([]);
        }
      }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routesLibrary, destination.position, travelMode, imperial,
      effectiveOrigin.lat, effectiveOrigin.lng]);

  const colors = getMarkerColor(destination.type);
  const poiData = destination.data as any;
  const travelLabel = travelBadgeLabel(destination);

  const typeLabel =
    destination.type === "restaurant" ? "Restaurant" :
    destination.type === "accessible" ? "Accessible restaurant" :
    destination.type === "attraction" ? "Attraction" : "";

  return (
    <div className="flex h-full w-96 shrink-0 flex-col border-l border-gray-200 bg-white shadow-xl overflow-hidden">
      {/* Colored POI header */}
      <div
        className="px-5 py-4 flex items-start justify-between gap-3"
        style={{ backgroundColor: colors.background + "22", borderBottom: `3px solid ${colors.background}` }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: colors.background, border: `2px solid ${colors.border}` }}
            />
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {typeLabel}
            </span>
            {poiData.externalRating != null && (
              <span className="ml-auto text-sm font-bold text-amber-600">
                ⭐ {Number(poiData.externalRating).toFixed(1)}
              </span>
            )}
          </div>
          <p className="font-bold text-gray-900 leading-snug text-base">{destination.title}</p>
          {(poiData.cuisine || poiData.category) && (
            <p className="mt-0.5 text-xs text-gray-500">
              {poiData.cuisine || poiData.category}
            </p>
          )}
          {poiData.address && (
            <p className="mt-0.5 text-xs text-gray-400 truncate">{poiData.address}</p>
          )}
          {travelLabel && (
            <span className="mt-1.5 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
              {travelLabel}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
            <path d="M1 1l16 16M17 1L1 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Origin callout */}
      <div className="flex items-center gap-2 bg-teal-50 border-b border-teal-100 px-5 py-2.5">
        <span className="text-teal-600 text-sm">✈️</span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-teal-800">
            From {originAirport.code}
            {usingRamp && <span className="ml-1 font-normal text-teal-600">(FBO/ramp)</span>}
          </p>
          <p className="text-xs text-teal-600 truncate">{originAirport.name}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Travel mode selector */}
        <div className="grid grid-cols-4 gap-1.5">
          {(["DRIVING", "WALKING", "BICYCLING", "TRANSIT"] as TravelMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setTravelMode(mode)}
              className={`flex flex-col items-center gap-0.5 rounded-lg border-2 py-2 transition-all text-xs font-medium ${
                travelMode === mode
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-600"
              }`}
            >
              <span className="text-lg leading-none">{MODE_ICONS[mode]}</span>
              <span className="capitalize">{mode.toLowerCase().replace("bicycling", "bike")}</span>
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-6 gap-2 text-sm text-gray-500">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
            Getting directions…
          </div>
        )}

        {/* Routes */}
        {!loading && routes.length > 0 && (
          <div className="space-y-3">
            {routes.map((route, index) => (
              <div
                key={index}
                onClick={() => setSelectedRouteIndex(index)}
                className={`cursor-pointer rounded-xl border-2 p-3.5 transition-all ${
                  selectedRouteIndex === index
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <p className="text-sm font-semibold text-gray-800 mb-2">
                  {route.summary || `Route ${index + 1}`}
                </p>
                <div className="flex gap-4 text-sm text-gray-600">
                  <span>📏 {route.legs[0].distance?.text}</span>
                  <span>⏱️ {route.legs[0].duration?.text}</span>
                </div>
                {route.legs[0].duration_in_traffic && (
                  <p className="mt-1 text-xs text-gray-500">
                    🚦 In traffic: {route.legs[0].duration_in_traffic.text}
                  </p>
                )}

                {selectedRouteIndex === index && (
                  <div className="mt-3 border-t border-blue-200 pt-3 space-y-2.5">
                    {route.legs[0].steps.map((step, i) => (
                      <div key={i} className="flex gap-2.5 pb-2.5 border-b border-gray-100 last:border-0 last:pb-0">
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div
                            dangerouslySetInnerHTML={{ __html: sanitizeInstructions(step.instructions) }}
                            className="text-xs text-gray-800"
                          />
                          <p className="mt-0.5 text-xs text-gray-400">
                            {step.distance?.text} · {step.duration?.text}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* No routes */}
        {!loading && routes.length === 0 && (
          <div className="rounded-xl bg-yellow-50 border border-yellow-200 p-4 text-center">
            <p className="text-sm text-yellow-800">
              No {travelMode.toLowerCase()} route found. Try a different travel mode.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
