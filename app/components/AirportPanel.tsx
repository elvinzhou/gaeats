import { useEffect, useState } from "react";

interface AirportData {
  code: string;
  name: string;
  city: string;
  state: string | null;
  country: string;
  latitude: number;
  longitude: number;
  facilityType: string | null;
  airportUse: string | null;
  elevation: number | null;
  controlTower: string | null;
  ctafFrequency: string | null;
  unicomFrequency: string | null;
  trafficPatternAltitude: number | null;
  magVariation: string | null;
  fuelTypes: string | null;
  landingFee: string | null;
  customsEntry: string | null;
  jointUse: string | null;
  airportStatus: string | null;
  singleEngineCount: number | null;
  multiEngineCount: number | null;
  jetEngineCount: number | null;
  helicopterCount: number | null;
  gliderCount: number | null;
  ultralightCount: number | null;
  fboName: string | null;
  fboPhone: string | null;
  fboWebsite: string | null;
  notes: string | null;
}

interface NearbyPoi {
  id: number;
  name: string;
  category: string | null;
  subcategory: string | null;
  cuisine: string | null;
  externalRating: number | null;
  address: string;
  city: string;
  distance: number;
  walkingMinutes: number | null;
  bikingMinutes: number | null;
  transitMinutes: number | null;
  drivingMinutes: number | null;
  preferredMode: string | null;
  needsRideshare: boolean | null;
  needsCrewCar: boolean | null;
}

interface PanelApiResponse {
  airport: AirportData;
  pois: NearbyPoi[];
  count: number;
}

type PoiType = "RESTAURANT" | "ATTRACTION";

interface AirportPanelProps {
  airportCode: string;
  onClose: () => void;
  onGetDirections: (destination: { lat: number; lng: number; name: string }) => void;
}

function TravelBadge({ poi }: { poi: NearbyPoi }) {
  if (poi.preferredMode === "WALKING") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
        🚶 {poi.walkingMinutes != null ? `${poi.walkingMinutes} min` : "Walkable"}
      </span>
    );
  }
  if (poi.preferredMode === "BIKING") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
        🚲 {poi.bikingMinutes != null ? `${poi.bikingMinutes} min` : "Bikeable"}
      </span>
    );
  }
  if (poi.preferredMode === "TRANSIT") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
        🚌 {poi.transitMinutes != null ? `${poi.transitMinutes} min` : "Transit"}
      </span>
    );
  }
  if (poi.preferredMode === "DRIVING") {
    const label = poi.needsRideshare ? "Rideshare" : "Drive";
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
        🚗 {label}{poi.drivingMinutes != null ? ` · ${poi.drivingMinutes} min` : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-yellow-100 bg-yellow-50 px-2.5 py-0.5 text-xs italic text-yellow-700">
      Reachability pending
    </span>
  );
}

export default function AirportPanel({ airportCode, onClose, onGetDirections }: AirportPanelProps) {
  const [data, setData] = useState<PanelApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [poiType, setPoiType] = useState<PoiType>("RESTAURANT");

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/airports/${encodeURIComponent(airportCode)}?distance=15&minRating=0&type=${poiType}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d) => {
        setData(d as PanelApiResponse);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load airport details.");
        setLoading(false);
      });
  }, [airportCode, poiType]);

  function handleGetDirections() {
    if (!data) return;
    onGetDirections({
      lat: data.airport.latitude,
      lng: data.airport.longitude,
      name: `${data.airport.code} – ${data.airport.name}`,
    });
    onClose();
  }

  const airport = data?.airport;

  return (
    <div className="flex h-full w-96 shrink-0 flex-col border-l border-gray-200 bg-white shadow-xl">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-gray-200 p-5">
        <div className="min-w-0 flex-1 pr-3">
          {loading && !data ? (
            <div className="space-y-2">
              <div className="h-5 w-40 animate-pulse rounded bg-gray-200" />
              <div className="h-4 w-28 animate-pulse rounded bg-gray-100" />
            </div>
          ) : error ? (
            <p className="text-sm font-semibold text-red-600">Error loading airport</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded-full bg-teal-100 px-2.5 py-0.5 text-sm font-bold text-teal-800">
                  {airport?.code}
                </span>
                {airport?.airportUse === "PR" && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    Private
                  </span>
                )}
              </div>
              <p className="mt-1.5 truncate font-semibold text-gray-900">{airport?.name}</p>
              <p className="mt-0.5 text-xs text-gray-500">
                {airport?.city}{airport?.state ? `, ${airport.state}` : ""} &bull; {airport?.country}
                {airport?.elevation != null ? ` · ${airport.elevation.toLocaleString()} ft MSL` : ""}
              </p>
            </>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close panel"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M1 1l16 16M17 1L1 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {loading && !data && (
          <div className="flex h-40 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-teal-500" />
          </div>
        )}

        {error && !loading && (
          <p className="p-6 text-center text-sm text-red-500">{error}</p>
        )}

        {data && (
          <>
            {/* Airport Info */}
            {(airport?.ctafFrequency || airport?.unicomFrequency || airport?.controlTower || airport?.fuelTypes || airport?.airportStatus) && (
              <section className="border-b border-gray-100 bg-blue-50 px-5 py-4">
                <h3 className="mb-2.5 text-sm font-semibold text-blue-900">Airport Info</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  {airport?.airportStatus && (
                    <div className="col-span-2">
                      <span className="font-medium text-gray-600">Status: </span>
                      <span className={airport.airportStatus === "O" ? "font-semibold text-green-700" : "font-semibold text-red-700"}>
                        {airport.airportStatus === "O" ? "Operational" : airport.airportStatus === "CI" ? "Closed Indefinitely" : airport.airportStatus === "CP" ? "Closed Permanently" : airport.airportStatus}
                      </span>
                    </div>
                  )}
                  {airport?.controlTower && (
                    <p className="text-gray-600">
                      <span className="font-medium text-gray-700">Tower: </span>
                      {airport.controlTower === "Y" ? "Yes" : "No"}
                    </p>
                  )}
                  {airport?.ctafFrequency && (
                    <p className="text-gray-600">
                      <span className="font-medium text-gray-700">CTAF: </span>
                      {airport.ctafFrequency}
                    </p>
                  )}
                  {airport?.unicomFrequency && (
                    <p className="text-gray-600">
                      <span className="font-medium text-gray-700">UNICOM: </span>
                      {airport.unicomFrequency}
                    </p>
                  )}
                  {airport?.trafficPatternAltitude && (
                    <p className="text-gray-600">
                      <span className="font-medium text-gray-700">TPA: </span>
                      {airport.trafficPatternAltitude.toLocaleString()} ft AGL
                    </p>
                  )}
                  {airport?.magVariation && (
                    <p className="text-gray-600">
                      <span className="font-medium text-gray-700">Mag Var: </span>
                      {airport.magVariation}
                    </p>
                  )}
                  {airport?.fuelTypes && (
                    <div className="col-span-2 text-gray-600">
                      <span className="font-medium text-gray-700">Fuel: </span>
                      {airport.fuelTypes.trim()}
                    </div>
                  )}
                  {airport?.landingFee && (
                    <p className="text-gray-600">
                      <span className="font-medium text-gray-700">Landing Fee: </span>
                      {airport.landingFee === "Y" ? "Yes" : "No"}
                    </p>
                  )}
                  {airport?.customsEntry === "Y" && (
                    <p className="col-span-2 font-medium text-blue-700">Customs Port of Entry</p>
                  )}
                  {airport?.jointUse === "Y" && (
                    <p className="col-span-2 text-gray-600">Joint civil/military use</p>
                  )}
                </div>
                {(() => {
                  const total = (airport?.singleEngineCount ?? 0) + (airport?.multiEngineCount ?? 0) +
                    (airport?.jetEngineCount ?? 0) + (airport?.helicopterCount ?? 0) +
                    (airport?.gliderCount ?? 0) + (airport?.ultralightCount ?? 0);
                  if (!total) return null;
                  return (
                    <p className="mt-2 text-xs text-gray-600">
                      <span className="font-medium text-gray-700">Based aircraft: </span>
                      {total.toLocaleString()}
                      {airport?.singleEngineCount ? ` (${airport.singleEngineCount} SE` : ""}
                      {airport?.multiEngineCount ? `, ${airport.multiEngineCount} ME` : ""}
                      {airport?.jetEngineCount ? `, ${airport.jetEngineCount} jet` : ""}
                      {airport?.helicopterCount ? `, ${airport.helicopterCount} helo` : ""}
                      {total > 0 ? ")" : ""}
                    </p>
                  );
                })()}
              </section>
            )}

            {/* FBO */}
            {(airport?.fboName || airport?.fboPhone || airport?.fboWebsite || airport?.notes) && (
              <section className="border-b border-gray-100 bg-teal-50 px-5 py-4">
                <h3 className="mb-2.5 text-sm font-semibold text-teal-900">FBO / Services</h3>
                <div className="space-y-1.5 text-xs">
                  {airport.fboName && <p className="font-medium text-teal-800">{airport.fboName}</p>}
                  {airport.fboPhone && (
                    <p className="text-gray-600">
                      📞{" "}
                      <a href={`tel:${airport.fboPhone}`} className="hover:underline">
                        {airport.fboPhone}
                      </a>
                    </p>
                  )}
                  {airport.fboWebsite && (
                    <p>
                      🌐{" "}
                      <a href={airport.fboWebsite} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        FBO Website
                      </a>
                    </p>
                  )}
                  {airport.notes && <p className="italic text-gray-500">{airport.notes}</p>}
                </div>
              </section>
            )}

            {/* POI Type Tabs + List */}
            <section className="px-5 py-4">
              {/* Tabs */}
              <div className="mb-4 flex gap-2">
                <button
                  onClick={() => setPoiType("RESTAURANT")}
                  className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors ${
                    poiType === "RESTAURANT"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  🍴 Restaurants
                </button>
                <button
                  onClick={() => setPoiType("ATTRACTION")}
                  className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors ${
                    poiType === "ATTRACTION"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  🎡 Attractions
                </button>
              </div>

              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">
                  {poiType === "RESTAURANT" ? "Nearby Restaurants" : "Nearby Attractions"}
                </h3>
                <span className="text-xs text-gray-400">within 15 km</span>
              </div>

              {/* Loading state for tab switch */}
              {loading && data && (
                <div className="flex h-20 items-center justify-center">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-teal-500" />
                </div>
              )}

              {!loading && data.pois.length === 0 && (
                <p className="py-6 text-center text-sm italic text-gray-400">
                  No {poiType === "RESTAURANT" ? "restaurants" : "attractions"} found nearby yet.
                </p>
              )}

              {!loading && data.pois.length > 0 && (
                <div className="space-y-3">
                  {data.pois.map((poi) => (
                    <div
                      key={poi.id}
                      className="rounded-xl border border-gray-100 bg-gray-50 p-3.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-gray-900 leading-snug">{poi.name}</p>
                        {poi.externalRating != null && (
                          <span className="shrink-0 text-xs font-semibold text-amber-600">
                            ⭐ {poi.externalRating.toFixed(1)}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {poi.cuisine || poi.category || (poiType === "RESTAURANT" ? "Restaurant" : "Attraction")}
                        {poi.distance != null ? ` · ${(poi.distance / 1000).toFixed(1)} km` : ""}
                      </p>
                      {poi.address && (
                        <p className="mt-0.5 truncate text-xs text-gray-400">{poi.address}</p>
                      )}
                      <div className="mt-2">
                        <TravelBadge poi={poi} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Footer */}
      {data && !loading && (
        <div className="border-t border-gray-200 p-4">
          <button
            onClick={handleGetDirections}
            className="w-full rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
          >
            ✈️ Get Directions to Airport
          </button>
        </div>
      )}
    </div>
  );
}
