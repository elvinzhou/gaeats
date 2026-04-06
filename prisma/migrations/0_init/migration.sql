-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "PoiType" AS ENUM ('RESTAURANT', 'ATTRACTION');

-- CreateEnum
CREATE TYPE "ExternalSource" AS ENUM ('GOOGLE_MAPS', 'YELP', 'MANUAL', 'CLAIMED_LISTING', 'IMPORT');

-- CreateEnum
CREATE TYPE "AccessMode" AS ENUM ('WALKING', 'BIKING', 'TRANSIT', 'RIDESHARE', 'CREW_CAR', 'COURTESY_SHUTTLE', 'RESTAURANT_SHUTTLE', 'DRIVING');

-- CreateEnum
CREATE TYPE "AvailabilityStatus" AS ENUM ('YES', 'NO', 'LIMITED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "AccessSourceType" AS ENUM ('AIRPORT', 'FBO', 'RESTAURANT', 'PILOT_REVIEW', 'CLAIMED_LISTING', 'INFERRED', 'MANUAL');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('OPERATOR_CONFIRMATION', 'PUBLISHED_SOURCE', 'PILOT_CONFIRMATION', 'CLAIMED_LISTING_UPDATE', 'INFERENCE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AirportSource" AS ENUM ('FAA', 'MANUAL');

-- CreateTable
CREATE TABLE "airports" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "faaCode" VARCHAR(10),
    "icaoCode" VARCHAR(10),
    "iataCode" VARCHAR(10),
    "source" "AirportSource" NOT NULL DEFAULT 'MANUAL',
    "sourceDataset" VARCHAR(255),
    "sourceRecordUpdatedAt" TIMESTAMPTZ,
    "sourceRefreshedAt" TIMESTAMPTZ,
    "name" VARCHAR(255) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(10),
    "country" VARCHAR(10) NOT NULL DEFAULT 'US',
    "fboName" VARCHAR(255),
    "fboPhone" VARCHAR(50),
    "fboWebsite" VARCHAR(500),
    "notes" TEXT,
    "lastVerifiedAt" TIMESTAMPTZ,
    "lastPoiSyncAt" TIMESTAMPTZ,
    "nextPoiSyncAt" TIMESTAMPTZ,
    "syncPriority" INTEGER NOT NULL DEFAULT 100,
    "location" geography(Point, 4326) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "airports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pois" (
    "id" SERIAL NOT NULL,
    "source" "ExternalSource" NOT NULL,
    "externalSourceId" VARCHAR(255),
    "type" "PoiType" NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "category" VARCHAR(100),
    "subcategory" VARCHAR(100),
    "cuisine" VARCHAR(100),
    "description" TEXT,
    "address" VARCHAR(500) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(10),
    "country" VARCHAR(10) NOT NULL DEFAULT 'US',
    "priceLevel" INTEGER,
    "externalRating" DOUBLE PRECISION,
    "externalReviewCount" INTEGER,
    "pilotRating" DOUBLE PRECISION,
    "pilotReviewCount" INTEGER NOT NULL DEFAULT 0,
    "url" VARCHAR(500),
    "phone" VARCHAR(50),
    "hoursJson" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMPTZ,
    "location" geography(Point, 4326) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pois_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airport_pois" (
    "id" SERIAL NOT NULL,
    "airportId" INTEGER NOT NULL,
    "poiId" INTEGER NOT NULL,
    "straightLineDistanceMeters" DOUBLE PRECISION,
    "walkingMinutes" INTEGER,
    "bikingMinutes" INTEGER,
    "transitMinutes" INTEGER,
    "drivingMinutes" INTEGER,
    "preferredMode" "AccessMode",
    "accessConfidence" "ConfidenceLevel",
    "reachabilityScore" DOUBLE PRECISION,
    "needsCrewCar" BOOLEAN,
    "needsRideshare" BOOLEAN,
    "accessSummary" TEXT,
    "lastCalculatedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "airport_pois_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airport_access_facts" (
    "id" SERIAL NOT NULL,
    "airportId" INTEGER NOT NULL,
    "mode" "AccessMode" NOT NULL,
    "status" "AvailabilityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'LOW',
    "sourceType" "AccessSourceType" NOT NULL,
    "sourceDetail" TEXT,
    "sourceUrl" VARCHAR(500),
    "note" TEXT,
    "lastVerifiedAt" TIMESTAMPTZ,
    "verificationMethod" "VerificationMethod",
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "airport_access_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poi_access_facts" (
    "id" SERIAL NOT NULL,
    "poiId" INTEGER NOT NULL,
    "mode" "AccessMode" NOT NULL,
    "status" "AvailabilityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'LOW',
    "sourceType" "AccessSourceType" NOT NULL,
    "sourceDetail" TEXT,
    "sourceUrl" VARCHAR(500),
    "note" TEXT,
    "lastVerifiedAt" TIMESTAMPTZ,
    "verificationMethod" "VerificationMethod",
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "poi_access_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pilot_reviews" (
    "id" SERIAL NOT NULL,
    "airportId" INTEGER,
    "poiId" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" VARCHAR(255),
    "body" TEXT,
    "tags" TEXT[],
    "visitedAt" TIMESTAMPTZ,
    "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pilot_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pilot_access_reports" (
    "id" SERIAL NOT NULL,
    "airportId" INTEGER NOT NULL,
    "poiId" INTEGER,
    "mode" "AccessMode" NOT NULL,
    "status" "AvailabilityStatus" NOT NULL,
    "confidence" "ConfidenceLevel",
    "note" TEXT,
    "happenedAt" TIMESTAMPTZ,
    "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pilot_access_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_claims" (
    "id" SERIAL NOT NULL,
    "poiId" INTEGER NOT NULL,
    "claimantName" VARCHAR(255) NOT NULL,
    "claimantEmail" VARCHAR(255) NOT NULL,
    "claimantPhone" VARCHAR(50),
    "businessName" VARCHAR(255),
    "website" VARCHAR(500),
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "verificationNotes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "listing_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "airports_code_key" ON "airports"("code");

-- CreateIndex
CREATE UNIQUE INDEX "airports_faaCode_key" ON "airports"("faaCode");

-- CreateIndex
CREATE UNIQUE INDEX "airports_icaoCode_key" ON "airports"("icaoCode");

-- CreateIndex
CREATE UNIQUE INDEX "airports_iataCode_key" ON "airports"("iataCode");

-- CreateIndex
CREATE INDEX "airports_location_idx" ON "airports" USING GIST ("location");

-- CreateIndex
CREATE INDEX "airports_nextPoiSyncAt_syncPriority_idx" ON "airports"("nextPoiSyncAt", "syncPriority");

-- CreateIndex
CREATE INDEX "pois_type_idx" ON "pois"("type");

-- CreateIndex
CREATE INDEX "pois_externalRating_idx" ON "pois"("externalRating");

-- CreateIndex
CREATE INDEX "pois_pilotRating_idx" ON "pois"("pilotRating");

-- CreateIndex
CREATE INDEX "pois_location_idx" ON "pois" USING GIST ("location");

-- CreateIndex
CREATE UNIQUE INDEX "pois_source_externalSourceId_key" ON "pois"("source", "externalSourceId");

-- CreateIndex
CREATE INDEX "airport_pois_preferredMode_idx" ON "airport_pois"("preferredMode");

-- CreateIndex
CREATE INDEX "airport_pois_reachabilityScore_idx" ON "airport_pois"("reachabilityScore");

-- CreateIndex
CREATE UNIQUE INDEX "airport_pois_airportId_poiId_key" ON "airport_pois"("airportId", "poiId");

-- CreateIndex
CREATE INDEX "airport_access_facts_status_confidence_idx" ON "airport_access_facts"("status", "confidence");

-- CreateIndex
CREATE INDEX "airport_access_facts_lastVerifiedAt_idx" ON "airport_access_facts"("lastVerifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "airport_access_facts_airportId_mode_key" ON "airport_access_facts"("airportId", "mode");

-- CreateIndex
CREATE INDEX "poi_access_facts_status_confidence_idx" ON "poi_access_facts"("status", "confidence");

-- CreateIndex
CREATE INDEX "poi_access_facts_lastVerifiedAt_idx" ON "poi_access_facts"("lastVerifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "poi_access_facts_poiId_mode_key" ON "poi_access_facts"("poiId", "mode");

-- CreateIndex
CREATE INDEX "pilot_reviews_poiId_moderationStatus_idx" ON "pilot_reviews"("poiId", "moderationStatus");

-- CreateIndex
CREATE INDEX "pilot_reviews_airportId_moderationStatus_idx" ON "pilot_reviews"("airportId", "moderationStatus");

-- CreateIndex
CREATE INDEX "pilot_access_reports_airportId_mode_moderationStatus_idx" ON "pilot_access_reports"("airportId", "mode", "moderationStatus");

-- CreateIndex
CREATE INDEX "pilot_access_reports_poiId_mode_moderationStatus_idx" ON "pilot_access_reports"("poiId", "mode", "moderationStatus");

-- CreateIndex
CREATE INDEX "listing_claims_status_idx" ON "listing_claims"("status");

-- CreateIndex
CREATE INDEX "listing_claims_claimantEmail_idx" ON "listing_claims"("claimantEmail");

-- AddForeignKey
ALTER TABLE "airport_pois" ADD CONSTRAINT "airport_pois_airportId_fkey" FOREIGN KEY ("airportId") REFERENCES "airports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "airport_pois" ADD CONSTRAINT "airport_pois_poiId_fkey" FOREIGN KEY ("poiId") REFERENCES "pois"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "airport_access_facts" ADD CONSTRAINT "airport_access_facts_airportId_fkey" FOREIGN KEY ("airportId") REFERENCES "airports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poi_access_facts" ADD CONSTRAINT "poi_access_facts_poiId_fkey" FOREIGN KEY ("poiId") REFERENCES "pois"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilot_reviews" ADD CONSTRAINT "pilot_reviews_airportId_fkey" FOREIGN KEY ("airportId") REFERENCES "airports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilot_reviews" ADD CONSTRAINT "pilot_reviews_poiId_fkey" FOREIGN KEY ("poiId") REFERENCES "pois"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilot_access_reports" ADD CONSTRAINT "pilot_access_reports_airportId_fkey" FOREIGN KEY ("airportId") REFERENCES "airports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilot_access_reports" ADD CONSTRAINT "pilot_access_reports_poiId_fkey" FOREIGN KEY ("poiId") REFERENCES "pois"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_claims" ADD CONSTRAINT "listing_claims_poiId_fkey" FOREIGN KEY ("poiId") REFERENCES "pois"("id") ON DELETE CASCADE ON UPDATE CASCADE;

