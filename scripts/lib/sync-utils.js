export function calculateDistanceMeters(pointA, pointB) {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(pointB.latitude - pointA.latitude);
  const dLon = toRadians(pointB.longitude - pointA.longitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(pointA.latitude)) *
      Math.cos(toRadians(pointB.latitude)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function derivePoiCategory(place) {
  if (place.primaryType) {
    return place.primaryType;
  }

  return place.types?.[0] ?? null;
}

export function derivePoiSubcategory(place) {
  return place.types?.[1] ?? null;
}

export function normalizePoiType(kind) {
  return kind === "ATTRACTION" ? "ATTRACTION" : "RESTAURANT";
}

export function chooseNextPoiSyncAt(options = {}) {
  const {
    now = new Date(),
    airportCount = 1,
    desiredCycleDays = 30,
    minDays = 1,
  } = options;

  const dailyBatchSize = Math.max(1, Math.ceil(airportCount / desiredCycleDays));
  const spacingDays = Math.max(minDays, Math.floor(desiredCycleDays / dailyBatchSize));

  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + spacingDays);
  return next;
}

export function sortAirportsForSync(airports) {
  return [...airports].sort((left, right) => {
    // 1. Regional priority (NorCal > West Coast > Other)
    if (left.regionPriority !== right.regionPriority) {
      return left.regionPriority - right.regionPriority;
    }

    // 2. Freshness (Oldest sync/never synced first)
    const leftDue = left.nextPoiSyncAt ? new Date(left.nextPoiSyncAt).getTime() : 0;
    const rightDue = right.nextPoiSyncAt ? new Date(right.nextPoiSyncAt).getTime() : 0;

    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    // 3. Explicit sync priority
    return (left.syncPriority ?? 100) - (right.syncPriority ?? 100);
  });
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}
