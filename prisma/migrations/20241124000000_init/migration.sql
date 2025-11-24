-- CreateExtension: Enable PostGIS for geospatial queries
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateTable: airports
-- Stores information about public-use airports where pilots can land
CREATE TABLE "airports" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(10),
    "country" VARCHAR(10) NOT NULL DEFAULT 'US',
    "location" geography(Point, 4326) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "airports_pkey" PRIMARY KEY ("id")
);

-- CreateTable: restaurants
-- Stores information about high-rated restaurants near airports (rating > 4.0)
CREATE TABLE "restaurants" (
    "id" SERIAL NOT NULL,
    "googlePlaceId" VARCHAR(255),
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "cuisine" VARCHAR(100),
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "address" VARCHAR(500) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(10),
    "country" VARCHAR(10) NOT NULL DEFAULT 'US',
    "location" geography(Point, 4326) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique constraint on airport code
CREATE UNIQUE INDEX "airports_code_key" ON "airports"("code");

-- CreateIndex: Spatial index on airport location for fast geospatial queries
CREATE INDEX "airports_location_idx" ON "airports" USING GIST ("location");

-- CreateIndex: Unique constraint on Google Place ID
CREATE UNIQUE INDEX "restaurants_googlePlaceId_key" ON "restaurants"("googlePlaceId");

-- CreateIndex: Spatial index on restaurant location for fast geospatial queries
CREATE INDEX "restaurants_location_idx" ON "restaurants" USING GIST ("location");

-- CreateIndex: B-tree index on rating for filtering high-quality restaurants
CREATE INDEX "restaurants_rating_idx" ON "restaurants"("rating");
