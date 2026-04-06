-- CreateTable
CREATE TABLE "airport_fuel_cache" (
    "id" SERIAL NOT NULL,
    "icao" VARCHAR(10) NOT NULL,
    "hasFuel" BOOLEAN NOT NULL,
    "fbos" JSONB NOT NULL,
    "fetchedAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "airport_fuel_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "airport_fuel_cache_icao_key" ON "airport_fuel_cache"("icao");
