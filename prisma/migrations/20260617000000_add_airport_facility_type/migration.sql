-- AlterTable: add facilityType to airports
-- Populated by re-running the FAA NASR import after this migration.
-- Values: AIRPORT, HELIPORT, SEAPLANE BASE, GLIDERPORT, BALLOONPORT, ULTRALIGHT, STOLPORT
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "facilityType" VARCHAR(20);
