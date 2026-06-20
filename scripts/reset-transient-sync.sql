-- Reset transient parking sync schedule for all airports.
-- Re-queues everything into the next batch without touching existing notes.
UPDATE "airports"
SET
  "transientParkingLastSyncAt" = NULL,
  "updatedAt"                  = CURRENT_TIMESTAMP
WHERE "facilityType" = 'AIRPORT'
  AND ("transientStorageHangar" = true OR "transientStorageTiedown" = true)
  AND country = 'US';


-- Reset a single airport (replace KPAO with the target code):
-- UPDATE "airports"
-- SET
--   "transientParkingLastSyncAt" = NULL,
--   "updatedAt"                  = CURRENT_TIMESTAMP
-- WHERE UPPER(code) = 'KPAO';


-- Full wipe — also clears notes, source, and confidence:
-- UPDATE "airports"
-- SET
--   "transientParkingLastSyncAt" = NULL,
--   "transientParkingNotes"      = NULL,
--   "transientParkingSource"     = NULL,
--   "transientParkingConfidence" = NULL,
--   "updatedAt"                  = CURRENT_TIMESTAMP
-- WHERE "facilityType" = 'AIRPORT'
--   AND ("transientStorageHangar" = true OR "transientStorageTiedown" = true)
--   AND country = 'US';
