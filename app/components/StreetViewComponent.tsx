/**
 * Street View Component
 *
 * Displays Google Street View panorama for a given location.
 * Allows users to explore the street-level view of restaurants and airports.
 *
 * Features:
 * - Interactive panorama view
 * - Controllable heading and pitch
 * - Pan controls
 * - Address display
 *
 * @module StreetViewComponent
 */

import { useEffect, useRef } from "react";

/**
 * Props for StreetViewComponent
 */
interface StreetViewComponentProps {
  /** Position for street view */
  position: { lat: number; lng: number };
  /** Initial heading in degrees (default: 0) */
  heading?: number;
  /** Initial pitch in degrees (default: 0) */
  pitch?: number;
  /** Initial zoom level (default: 1) */
  zoom?: number;
  /** Container height (default: 400px) */
  height?: string;
}

/**
 * StreetViewComponent
 *
 * Renders an interactive Google Street View panorama
 *
 * @example
 * ```tsx
 * <StreetViewComponent
 *   position={{ lat: 40.7580, lng: -73.9855 }}
 *   heading={90}
 *   pitch={10}
 * />
 * ```
 */
export function StreetViewComponent({
  position,
  heading = 0,
  pitch = 0,
  zoom = 1,
  height = "400px",
}: StreetViewComponentProps) {
  const streetViewRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);

  useEffect(() => {
    if (!streetViewRef.current || typeof google === "undefined") return;

    // Initialize Street View panorama
    panoramaRef.current = new google.maps.StreetViewPanorama(
      streetViewRef.current,
      {
        position,
        pov: {
          heading,
          pitch,
        },
        zoom,
        addressControl: true, // Show address
        linksControl: true, // Show navigation links
        panControl: true, // Show pan control
        enableCloseButton: false, // Don't show close button
        zoomControl: true, // Show zoom control
        fullscreenControl: true, // Show fullscreen button
      }
    );

    // Cleanup on unmount
    return () => {
      if (panoramaRef.current) {
        panoramaRef.current = null;
      }
    };
  }, [position, heading, pitch, zoom]);

  return (
    <div
      ref={streetViewRef}
      style={{ width: "100%", height }}
      className="rounded-lg overflow-hidden"
    />
  );
}
