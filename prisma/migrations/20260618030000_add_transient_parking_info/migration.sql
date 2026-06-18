-- Airport-level website URL (distinct from FBO website stored in fboWebsite).
-- Scraped from AirNav or discovered via Brave Search.
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "websiteUrl" VARCHAR(512);

-- AI-synthesized transient parking summary produced by Gemini Flash.
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "transientParkingNotes" TEXT;

-- Pipe-separated list of sources used (e.g. "AIRNAV|PILOTSOFAMERICA|REDDIT").
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "transientParkingSource" VARCHAR(200);

-- Extraction confidence: HIGH | MEDIUM | LOW.
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "transientParkingConfidence" VARCHAR(10);

-- When the transient parking info was last synthesized.
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "transientParkingLastSyncAt" TIMESTAMPTZ;
