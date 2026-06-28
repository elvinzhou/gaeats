/**
 * Where to drop an airport's map marker.
 *
 * Pilots care about the transient/FBO ramp — where they actually park and walk
 * out from — not the airport reference point (ARP), which is the geometric
 * center of the runway system and essentially never where a visiting aircraft
 * parks. When we've resolved a ramp coordinate (via the FBO / OSM apron /
 * GPT-4o pipeline; see scripts/lib/ramp-coordinates.js), pin the marker there.
 * Otherwise fall back to the ARP.
 *
 * This keeps the green airport marker consistent with the directions origin,
 * which already prefers the ramp (see DirectionsRenderer usage in
 * GoogleMapComponent).
 */
export function airportMarkerPosition(airport: {
  latitude: number;
  longitude: number;
  rampLatitude?: number | null;
  rampLongitude?: number | null;
}): { lat: number; lng: number } {
  if (airport.rampLatitude != null && airport.rampLongitude != null) {
    return { lat: airport.rampLatitude, lng: airport.rampLongitude };
  }
  return { lat: airport.latitude, lng: airport.longitude };
}
