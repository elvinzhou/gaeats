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
  ownershipType: string | null;
  airportUse: string | null;
  elevation: number | null;
  fboName: string | null;
  fboPhone: string | null;
  fboWebsite: string | null;
  notes: string | null;
}

interface NearbyPoi {
  id: number;
  name: string;
  category: string | null;
  cuisine: string | null;
  externalRating: number | null;
  address: string;
  city: string;
  distance: number;
  walkingMinutes: number | null;
  drivingMinutes: number | null;
}

interface ModalApiResponse {
  airport: AirportData;
  pois: NearbyPoi[];
  count: number;
}

interface AirportModalProps {
  airportCode: string;
  onClose: () => void;
  onGetDirections: (destination: { lat: number; lng: number; name: string }) => void;
}

export default function AirportModal({ airportCode, onClose, onGetDirections }: AirportModalProps) {
  const [data, setData] = useState<ModalApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/airports/${encodeURIComponent(airportCode)}?distance=15&minRating=0&type=RESTAURANT`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d) => {
        setData(d as ModalApiResponse);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load airport details.");
        setLoading(false);
      });
  }, [airportCode]);

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleGetDirections() {
    if (!data) return;
    onGetDirections({
      lat: data.airport.latitude,
      lng: data.airport.longitude,
      name: `${data.airport.code} – ${data.airport.name}`,
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-200 p-6">
          <div className="min-w-0 flex-1 pr-4">
            {loading ? (
              <div className="space-y-2">
                <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
                <div className="h-4 w-32 animate-pulse rounded bg-gray-100" />
              </div>
            ) : error ? (
              <h2 className="text-xl font-bold text-red-600">Error loading airport</h2>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className="shrink-0 rounded-full bg-teal-100 px-3 py-1 text-sm font-bold text-teal-800">
                    {data?.airport.code}
                  </span>
                  <h2 className="truncate text-xl font-bold text-gray-900">{data?.airport.name}</h2>
                  {data?.airport.airportUse === "PR" && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      Private
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  {data?.airport.city}
                  {data?.airport.state ? `, ${data.airport.state}` : ""} &bull; {data?.airport.country}
                  {data?.airport.elevation != null ? ` · ${data.airport.elevation.toLocaleString()} ft MSL` : ""}
                </p>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M1 1l16 16M17 1L1 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex h-40 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-teal-500" />
            </div>
          )}

          {error && !loading && (
            <div className="p-6 text-center text-sm text-red-500">{error}</div>
          )}

          {data && !loading && (
            <>
              {/* FBO Info */}
              {(data.airport.fboName || data.airport.fboPhone || data.airport.fboWebsite || data.airport.notes) && (
                <div className="border-b border-gray-100 bg-teal-50 p-6">
                  <h3 className="mb-3 font-semibold text-teal-900">FBO / Airport Info</h3>
                  <div className="space-y-1.5">
                    {data.airport.fboName && (
                      <p className="text-sm font-medium text-teal-800">{data.airport.fboName}</p>
                    )}
                    {data.airport.fboPhone && (
                      <p className="text-sm text-gray-600">
                        📞{" "}
                        <a href={`tel:${data.airport.fboPhone}`} className="hover:underline">
                          {data.airport.fboPhone}
                        </a>
                      </p>
                    )}
                    {data.airport.fboWebsite && (
                      <p className="text-sm text-gray-600">
                        🌐{" "}
                        <a
                          href={data.airport.fboWebsite}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          FBO Website
                        </a>
                      </p>
                    )}
                    {data.airport.notes && (
                      <p className="mt-2 text-sm italic text-gray-500">{data.airport.notes}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Nearby Restaurants */}
              <div className="p-6">
                <h3 className="mb-4 font-semibold text-gray-900">
                  Nearby Restaurants
                  <span className="ml-2 text-sm font-normal text-gray-400">within 15 km</span>
                </h3>

                {data.pois.length === 0 ? (
                  <p className="text-sm italic text-gray-400">
                    No restaurants found nearby yet. Check back as we add more locations!
                  </p>
                ) : (
                  <div className="space-y-3">
                    {data.pois.map((poi) => (
                      <div
                        key={poi.id}
                        className="flex items-start gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-lg">
                          🍴
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-gray-900">{poi.name}</p>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {poi.cuisine || poi.category || "Restaurant"}
                            {poi.externalRating != null
                              ? ` · ⭐ ${poi.externalRating.toFixed(1)}`
                              : ""}
                            {poi.distance != null
                              ? ` · ${(poi.distance / 1000).toFixed(1)} km`
                              : ""}
                          </p>
                          {poi.address && (
                            <p className="mt-0.5 truncate text-xs text-gray-400">{poi.address}</p>
                          )}
                          {poi.walkingMinutes != null && (
                            <p className="mt-0.5 text-xs text-green-600">
                              🚶 {poi.walkingMinutes} min walk
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {data && !loading && (
          <div className="flex gap-3 border-t border-gray-200 p-4">
            <button
              onClick={handleGetDirections}
              className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
            >
              ✈️ Get Directions to Airport
            </button>
            <button
              onClick={onClose}
              className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-200"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
