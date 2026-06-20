ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "transientParkingNextSyncAt" TIMESTAMPTZ;
