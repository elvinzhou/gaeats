CREATE TABLE IF NOT EXISTS "airport_fbos" (
  "id"          SERIAL PRIMARY KEY,
  "airportId"   INTEGER NOT NULL REFERENCES "airports"("id") ON DELETE CASCADE,
  "name"        VARCHAR(120) NOT NULL,
  "placeId"     VARCHAR(255),
  "latitude"    DOUBLE PRECISION NOT NULL,
  "longitude"   DOUBLE PRECISION NOT NULL,
  "source"      VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "airport_fbos_airportId_idx" ON "airport_fbos"("airportId");
CREATE UNIQUE INDEX IF NOT EXISTS "airport_fbos_airportId_name_key" ON "airport_fbos"("airportId", "name");
