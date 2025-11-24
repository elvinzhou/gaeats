/**
 * Directions Renderer Component
 *
 * This component handles rendering directions on the Google Map from the user's
 * current location to a selected destination. It uses the Google Maps Directions API
 * to calculate the route and displays it on the map.
 *
 * Features:
 * - Automatically gets user's current location
 * - Supports multiple travel modes (driving, walking, bicycling, transit)
 * - Displays route on map with visual path
 * - Provides alternative routes when available
 *
 * @module DirectionsRenderer
 */

import { useEffect, useState } from "react";
import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";

/**
 * Travel mode options for directions
 */
export type TravelMode = "DRIVING" | "WALKING" | "BICYCLING" | "TRANSIT";

/**
 * Props for DirectionsRenderer component
 */
interface DirectionsRendererProps {
  /** Destination coordinates */
  destination: { lat: number; lng: number };
  /** Travel mode for directions (default: DRIVING) */
  travelMode?: TravelMode;
  /** Callback when directions are successfully calculated */
  onDirectionsResult?: (result: google.maps.DirectionsResult) => void;
}

/**
 * DirectionsRenderer Component
 *
 * Renders directions from user's current location to a destination on the map.
 * Automatically handles the DirectionsService and DirectionsRenderer lifecycle.
 *
 * @example
 * ```tsx
 * <DirectionsRenderer
 *   destination={{ lat: 40.7580, lng: -73.9855 }}
 *   travelMode="WALKING"
 *   onDirectionsResult={(result) => console.log(result)}
 * />
 * ```
 */
export function DirectionsRenderer({
  destination,
  travelMode = "DRIVING",
  onDirectionsResult,
}: DirectionsRendererProps) {
  const map = useMap();
  const routesLibrary = useMapsLibrary("routes");

  const [directionsService, setDirectionsService] =
    useState<google.maps.DirectionsService | null>(null);
  const [directionsRenderer, setDirectionsRenderer] =
    useState<google.maps.DirectionsRenderer | null>(null);

  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  // Initialize DirectionsService and DirectionsRenderer
  useEffect(() => {
    if (!routesLibrary || !map) return;

    const service = new routesLibrary.DirectionsService();
    const renderer = new routesLibrary.DirectionsRenderer({
      map,
      suppressMarkers: false, // Show start/end markers
      preserveViewport: false, // Auto-zoom to fit route
      polylineOptions: {
        strokeColor: "#4285F4",
        strokeOpacity: 0.8,
        strokeWeight: 5,
      },
    });

    setDirectionsService(service);
    setDirectionsRenderer(renderer);

    // Cleanup on unmount
    return () => {
      renderer.setMap(null);
    };
  }, [routesLibrary, map]);

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
          // Fallback to a default location (center of USA)
          setUserLocation({ lat: 39.8283, lng: -98.5795 });
        }
      );
    } else {
      // Fallback if geolocation not available
      setUserLocation({ lat: 39.8283, lng: -98.5795 });
    }
  }, []);

  // Calculate and display route
  useEffect(() => {
    if (!directionsService || !directionsRenderer || !userLocation) return;

    directionsService.route(
      {
        origin: userLocation,
        destination,
        travelMode: google.maps.TravelMode[travelMode],
        provideRouteAlternatives: true,
      },
      (response, status) => {
        if (status === "OK" && response) {
          directionsRenderer.setDirections(response);
          onDirectionsResult?.(response);
        } else {
          console.error("Directions request failed:", status);
        }
      }
    );
  }, [
    directionsService,
    directionsRenderer,
    destination,
    travelMode,
    userLocation,
    onDirectionsResult,
  ]);

  // This component doesn't render any visible elements
  return null;
}
