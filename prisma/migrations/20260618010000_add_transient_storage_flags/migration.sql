ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "transientStorageHangar" BOOLEAN;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "transientStorageTiedown" BOOLEAN;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "transientStorageBuoy" BOOLEAN;
