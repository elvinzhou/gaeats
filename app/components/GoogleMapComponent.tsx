import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
} from "@vis.gl/react-google-maps";
import { DirectionsRenderer } from "./DirectionsRenderer";
import { DirectionsPanel } from "./DirectionsPanel";
import AirportModal from "./AirportModal";
import type { Poi, Airport } from "~/types/models";

export interface POI {
  id: number;
  position: { lat: number; lng: number };
  title: string;
  type: "restaurant" | "airport" | "attraction";
  data: Poi | Airport;
}

type MapTypeId = "roadmap" | "satellite" | "hybrid" | "terrain";

interface GoogleMapComponentProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  pois: POI[];
  initialSelectedPoi?: { id: number; type: string } | null;
  initialAirportCode?: string | null;
}

// ---------- helpers ----------

const MARKER_COLORS: Record<string, { background: string; border: string }> = {
  restaurant: { background: "#FF6B6B", border: "#D64545" },
  airport:    { background: "#4ECDC4", border: "#399E97" },
  attraction: { background: "#FFD93D", border: "#C9A71A" },
  default:    { background: "#4D96FF", border: "#2E76E6" },
};

function getMarkerColors(type: string) {
  return MARKER_COLORS[type] ?? MARKER_COLORS.default;
}

// FAA NASR facility type helpers.
// When facilityType is NULL (pre-migration rows) we fall back to name patterns.

const SPECIALTY_TYPES = new Set(["GLIDERPORT", "BALLOONPORT", "ULTRALIGHT", "STOLPORT"]);

function getFacilityCategory(poi: POI): "airport" | "heliport" | "seaplane" | "specialty" | null {
  if (poi.type !== "airport") return null;
  const ft = (poi.data as Airport).facilityType?.toUpperCase().trim();
  if (!ft) {
    // Legacy fallback: classify by name
    if (/heliport|helipad/i.test(poi.title)) return "heliport";
    if (/seaplane|sea\s*base|float/i.test(poi.title)) return "seaplane";
    if (/glider|balloon|ultralight|stolport/i.test(poi.title)) return "specialty";
    return "airport";
  }
  if (ft === "AIRPORT") return "airport";
  if (ft === "HELIPORT") return "heliport";
  if (ft === "SEAPLANE BASE") return "seaplane";
  if (SPECIALTY_TYPES.has(ft)) return "specialty";
  return "airport"; // unknown future types: treat as standard
}

// ---------- Custom SVG pin + inline tooltip ----------

interface MapPinProps {
  colors: { background: string; border: string };
  scale: number;
}

function MapPinSvg({ colors, scale }: MapPinProps) {
  const w = Math.round(28 * scale);
  const h = Math.round(38 * scale);
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 28 38"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.4))" }}
    >
      {/* Teardrop path: tip at (14, 38) = bottom-center of the SVG. AdvancedMarker
          anchors at the bottom-center of its element, so the pin tip lands exactly on
          the map coordinate. */}
      <path
        d="M14 1C7.373 1 2 6.373 2 13C2 22 14 38 14 38C14 38 26 22 26 13C26 6.373 20.627 1 14 1Z"
        fill={colors.background}
        stroke={colors.border}
        strokeWidth="1.5"
      />
      <circle cx="14" cy="13" r="5" fill="white" opacity="0.85" />
    </svg>
  );
}

interface MarkerWithTooltipProps {
  poi: POI;
  isHovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}

function MarkerWithTooltip({ poi, isHovered, onMouseEnter, onMouseLeave, onClick }: MarkerWithTooltipProps) {
  const colors = getMarkerColors(poi.type);
  const scale = isHovered ? 1.25 : 1;

  return (
    <AdvancedMarker
      position={poi.position}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      title={poi.title}
    >
      {/* The wrapper div is sized to the pin SVG. The tooltip is absolutely
          positioned above it so it doesn't shift the marker anchor point. */}
      <div style={{ position: "relative", width: 28, height: 38, cursor: "pointer" }}>
        {isHovered && (
          <div
            style={{
              position: "absolute",
              bottom: "calc(100% + 6px)",
              left: "50%",
              transform: "translateX(-50%)",
              backgroundColor: "white",
              borderRadius: 8,
              padding: "6px 10px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              zIndex: 10,
            }}
          >
            <p style={{ margin: 0, fontWeight: 600, fontSize: 13, color: "#111" }}>{poi.title}</p>
            {poi.type !== "airport" && (poi.data as Poi).externalRating != null && (
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>
                ⭐ {(poi.data as Poi).externalRating!.toFixed(1)} / 5.0
              </p>
            )}
          </div>
        )}
        <MapPinSvg colors={colors} scale={scale} />
      </div>
    </AdvancedMarker>
  );
}

// ---------- MapController ----------

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
  const lastFetchRef = useRef<{ lat: number; lng: number; radius: number } | null>(null);

  useEffect(() => {
    if (!map) return;
    const prev = prevCenterRef.current;
    if (prev.lat !== center.lat || prev.lng !== center.lng) {
      map.panTo(center);
      map.setZoom(zoom);
      prevCenterRef.current = center;
    }
  }, [map, center, zoom]);

  useEffect(() => {
    if (!map) return;

    const listener = map.addListener("idle", async () => {
      const bounds = map.getBounds();
      const currentZoom = map.getZoom() ?? 0;
      if (!bounds || currentZoom < 6) return;

      const mapCenter = map.getCenter()!.toJSON();
      const ne = bounds.getNorthEast().toJSON();

      const latDiff = Math.abs(ne.lat - mapCenter.lat);
      const lngDiff = Math.abs(ne.lng - mapCenter.lng);
      const radiusKm = Math.min(Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111, 500);

      if (lastFetchRef.current) {
        const { lat, lng, radius } = lastFetchRef.current;
        const movedKm =
          Math.sqrt((lat - mapCenter.lat) ** 2 + (lng - mapCenter.lng) ** 2) * 111;
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
        // Non-fatal; existing markers stay visible.
      }
    });

    return () => listener.remove();
  }, [map, onAirportsFetched]);

  return null;
}

// ---------- Map Type Controls ----------

function MapTypeControls({
  mapTypeId,
  onMapTypeChange,
}: {
  mapTypeId: MapTypeId;
  onMapTypeChange: (type: MapTypeId) => void;
}) {
  const cls = (type: MapTypeId) =>
    `px-4 py-2 rounded-md transition-colors ${
      mapTypeId === type
        ? "bg-blue-600 text-white"
        : "bg-white text-gray-700 hover:bg-gray-100"
    }`;

  return (
    <div className="absolute right-4 top-4 z-10 flex gap-2 rounded-lg bg-white p-2 shadow-lg">
      <button onClick={() => onMapTypeChange("roadmap")} className={cls("roadmap")} title="Roadmap view">
        🗺️ Map
      </button>
      <button onClick={() => onMapTypeChange("satellite")} className={cls("satellite")} title="Satellite view">
        🛰️ Satellite
      </button>
      <button onClick={() => onMapTypeChange("hybrid")} className={cls("hybrid")} title="Hybrid view">
        🌐 Hybrid
      </button>
    </div>
  );
}

// ---------- Main component ----------

export default function GoogleMapComponent({
  center = { lat: 39.8283, lng: -98.5795 },
  zoom = 5,
  pois,
  initialSelectedPoi = null,
  initialAirportCode = null,
}: GoogleMapComponentProps) {
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null);
  const [mapTypeId, setMapTypeId] = useState<MapTypeId>("roadmap");
  const [hoveredPOI, setHoveredPOI] = useState<POI | null>(null);
  const [searchParams] = useSearchParams();

  // Airport modal state
  const [modalAirportCode, setModalAirportCode] = useState<string | null>(initialAirportCode);

  // Non-standard facility type filters — all hidden by default
  const [showHeliports, setShowHeliports] = useState(false);
  const [showSeaplanes, setShowSeaplanes] = useState(false);
  const [showSpecialty, setShowSpecialty] = useState(false);
  const [showPrivate, setShowPrivate] = useState(false);

  // Local POI state seeded from server, augmented by viewport fetches.
  const [localPois, setLocalPois] = useState<POI[]>(pois);

  // Refresh local pois when the loader delivers new data (e.g. after airport search).
  useEffect(() => {
    setLocalPois(pois);
  }, [pois]);

  // Open modal when the initialAirportCode prop changes (driven by URL ?airport= param).
  useEffect(() => {
    if (initialAirportCode) {
      setModalAirportCode(initialAirportCode);
    }
  }, [initialAirportCode]);

  // Merge newly fetched airport markers, deduplicating by type+id.
  const handleAirportsFetched = useCallback((incoming: POI[]) => {
    setLocalPois((prev) => {
      const existingKeys = new Set(prev.map((p) => `${p.type}-${p.id}`));
      const toAdd = incoming.filter((a) => !existingKeys.has(`airport-${a.id}`));
      return toAdd.length === 0 ? prev : [...prev, ...toAdd];
    });
  }, []);

  // Apply facility-type filters before rendering markers.
  const visiblePois = localPois.filter((poi) => {
    const cat = getFacilityCategory(poi);
    if (cat === null) return true; // non-airport POI — always show
    if (cat === "heliport") return showHeliports;
    if (cat === "seaplane") return showSeaplanes;
    if (cat === "specialty") return showSpecialty;
    // Private-use airports: hide unless opted in (only when airportUse is known)
    if (cat === "airport") {
      const au = (poi.data as Airport).airportUse;
      if (au === "PR" && !showPrivate) return false;
    }
    return true;
  });

  function handleMarkerClick(poi: POI) {
    if (poi.type === "airport") {
      const airport = poi.data as Airport;
      setModalAirportCode(airport.code);
    } else {
      setSelectedPOI(poi);
    }
  }

  function handleGetDirections(destination: { lat: number; lng: number; name: string }) {
    // Create a synthetic POI for the DirectionsPanel
    const airportPOI: POI = {
      id: -1,
      position: { lat: destination.lat, lng: destination.lng },
      title: destination.name,
      type: "airport",
      data: {} as Airport,
    };
    setSelectedPOI(airportPOI);
  }

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

  useEffect(() => {
    if (!apiKey || apiKey === "YOUR_GOOGLE_MAPS_API_KEY_HERE") {
      console.error("Google Maps API key is missing! Please set VITE_GOOGLE_MAPS_API_KEY in your .env file");
    }
  }, [apiKey]);

  return (
    <APIProvider apiKey={apiKey || ""}>
      <div className="flex h-screen w-full">
        <div className="relative flex-1">
          <Map
            defaultCenter={center}
            defaultZoom={zoom}
            mapId={mapId}
            gestureHandling="greedy"
            disableDefaultUI={false}
            mapTypeId={mapTypeId}
            className="h-full w-full google-maps-container"
          >
            <MapController center={center} zoom={zoom} onAirportsFetched={handleAirportsFetched} />

            {visiblePois.map((poi) => (
              <MarkerWithTooltip
                key={`${poi.type}-${poi.id}`}
                poi={poi}
                isHovered={hoveredPOI?.id === poi.id && hoveredPOI?.type === poi.type}
                onMouseEnter={() => setHoveredPOI(poi)}
                onMouseLeave={() => setHoveredPOI(null)}
                onClick={() => handleMarkerClick(poi)}
              />
            ))}

            {/* Directions route overlay — only for restaurant/attraction selections */}
            {selectedPOI && (
              <DirectionsRenderer
                destination={selectedPOI.position}
                travelMode={(searchParams.get("mode") as any) || "DRIVING"}
              />
            )}
          </Map>

          <MapTypeControls mapTypeId={mapTypeId} onMapTypeChange={setMapTypeId} />

          {/* Legend + filters */}
          <div className="absolute bottom-6 left-6 rounded-lg bg-white p-4 shadow-lg min-w-[160px]">
            <h3 className="mb-2 font-semibold text-sm">Legend</h3>
            <div className="space-y-1.5 mb-4">
              <div className="flex items-center gap-2">
                <div className="h-3.5 w-3.5 rounded-full bg-[#FF6B6B] shrink-0" />
                <span className="text-sm">Restaurants</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3.5 w-3.5 rounded-full bg-[#4ECDC4] shrink-0" />
                <span className="text-sm">Airports</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3.5 w-3.5 rounded-full bg-[#FFD93D] shrink-0" />
                <span className="text-sm">Attractions</span>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-3">
              <h3 className="mb-2 font-semibold text-sm text-gray-700">Also show</h3>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm select-none">
                  <input
                    type="checkbox"
                    checked={showHeliports}
                    onChange={(e) => setShowHeliports(e.target.checked)}
                    className="h-3.5 w-3.5 accent-teal-600"
                  />
                  Heliports
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm select-none">
                  <input
                    type="checkbox"
                    checked={showSeaplanes}
                    onChange={(e) => setShowSeaplanes(e.target.checked)}
                    className="h-3.5 w-3.5 accent-teal-600"
                  />
                  Seaplane bases
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm select-none">
                  <input
                    type="checkbox"
                    checked={showSpecialty}
                    onChange={(e) => setShowSpecialty(e.target.checked)}
                    className="h-3.5 w-3.5 accent-teal-600"
                  />
                  <span title="Gliderports, balloonports, ultralights, STOLports">
                    Specialty fields
                  </span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm select-none">
                  <input
                    type="checkbox"
                    checked={showPrivate}
                    onChange={(e) => setShowPrivate(e.target.checked)}
                    className="h-3.5 w-3.5 accent-teal-600"
                  />
                  Private airports
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Directions panel for restaurant / attraction clicks */}
        {selectedPOI && (
          <DirectionsPanel destination={selectedPOI} onClose={() => setSelectedPOI(null)} />
        )}
      </div>

      {/* Airport info modal */}
      {modalAirportCode && (
        <AirportModal
          airportCode={modalAirportCode}
          onClose={() => setModalAirportCode(null)}
          onGetDirections={handleGetDirections}
        />
      )}
    </APIProvider>
  );
}
