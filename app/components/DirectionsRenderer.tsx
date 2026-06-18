import { useEffect, useState } from "react";
import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";

export type TravelMode = "DRIVING" | "WALKING" | "BICYCLING" | "TRANSIT";

interface DirectionsRendererProps {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  travelMode?: TravelMode;
  unitSystem?: "IMPERIAL" | "METRIC";
}

export function DirectionsRenderer({
  origin,
  destination,
  travelMode = "DRIVING",
  unitSystem = "IMPERIAL",
}: DirectionsRendererProps) {
  const map = useMap();
  const routesLibrary = useMapsLibrary("routes");
  const [service, setService] = useState<google.maps.DirectionsService | null>(null);
  const [renderer, setRenderer] = useState<google.maps.DirectionsRenderer | null>(null);

  useEffect(() => {
    if (!routesLibrary || !map) return;
    const svc = new routesLibrary.DirectionsService();
    const rnd = new routesLibrary.DirectionsRenderer({
      map,
      suppressMarkers: false,
      preserveViewport: false,
      polylineOptions: { strokeColor: "#4285F4", strokeOpacity: 0.8, strokeWeight: 5 },
    });
    setService(svc);
    setRenderer(rnd);
    return () => rnd.setMap(null);
  }, [routesLibrary, map]);

  useEffect(() => {
    if (!service || !renderer) return;
    service.route(
      {
        origin,
        destination,
        travelMode: google.maps.TravelMode[travelMode],
        unitSystem: unitSystem === "IMPERIAL"
          ? google.maps.UnitSystem.IMPERIAL
          : google.maps.UnitSystem.METRIC,
        provideRouteAlternatives: false,
      },
      (response, status) => {
        if (status === "OK" && response) {
          renderer.setDirections(response);
        } else {
          renderer.setDirections(null as any);
        }
      }
    );
  }, [service, renderer, origin, destination, travelMode, unitSystem]);

  return null;
}
