export interface ChooseNextPoiSyncAtOptions {
  now?: Date;
  airportCount?: number;
  desiredCycleDays?: number;
  minDays?: number;
}

export function chooseNextPoiSyncAt(options: ChooseNextPoiSyncAtOptions) {
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
