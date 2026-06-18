const KM_TO_MILES = 0.621371;
const M_TO_FEET = 3.28084;

export function formatDistance(meters: number, imperial: boolean): string {
  if (imperial) {
    const miles = (meters / 1000) * KM_TO_MILES;
    if (miles < 0.1) return `${Math.round(meters * M_TO_FEET)} ft`;
    return `${miles.toFixed(1)} mi`;
  }
  const km = meters / 1000;
  if (km < 1) return `${Math.round(meters)} m`;
  return `${km.toFixed(1)} km`;
}

export function formatRadius(km: number, imperial: boolean): string {
  if (imperial) return `${Math.round(km * KM_TO_MILES)} mi`;
  return `${km} km`;
}
