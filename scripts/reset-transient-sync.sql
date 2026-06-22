-- Reset the transient parking sync from scratch.
--
-- The batch pipeline never produced usable data: the collect step had a bug
-- that stamped "transientParkingLastSyncAt" without storing anything, and the
-- Gemini batches have since expired. This wipes all transient parking fields
-- and clears the job table so every eligible airport is re-queued on the next
-- submit run.
--
-- Run with:  psql "$DIRECT_URL" -f scripts/reset-transient-sync.sql

-- Preview how many airports will be re-queued (optional — run on its own first):
--   SELECT count(*) FROM "airports"
--   WHERE "facilityType" = 'AIRPORT'
--     AND ("transientStorageHangar" = true OR "transientStorageTiedown" = true)
--     AND country = 'US';

BEGIN;

-- 1. Wipe transient parking data and clear the sync timestamp. Submit selects
--    rows whose "transientParkingLastSyncAt" IS NULL, so this re-queues them.
UPDATE "airports"
SET
  "transientParkingNotes"      = NULL,
  "transientParkingSource"     = NULL,
  "transientParkingConfidence" = NULL,
  "transientParkingLastSyncAt" = NULL,
  "updatedAt"                  = CURRENT_TIMESTAMP
WHERE "facilityType" = 'AIRPORT'
  AND ("transientStorageHangar" = true OR "transientStorageTiedown" = true)
  AND country = 'US';

-- 2. Clear batch job records. A leftover PENDING job blocks the next submit;
--    DONE rows are the buggy runs. Nothing here is worth keeping.
DELETE FROM "transient_sync_jobs";

COMMIT;


-- ----------------------------------------------------------------------------
-- Gentler alternatives — use INSTEAD of the block above if ever needed:
--
-- Re-queue everything but KEEP existing notes:
--   UPDATE "airports"
--   SET "transientParkingLastSyncAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
--   WHERE "facilityType" = 'AIRPORT'
--     AND ("transientStorageHangar" = true OR "transientStorageTiedown" = true)
--     AND country = 'US';
--
-- Reset a single airport (replace KPAO with the target code):
--   UPDATE "airports"
--   SET "transientParkingLastSyncAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
--   WHERE UPPER(code) = 'KPAO';
