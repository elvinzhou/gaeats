-- Add additional FAA NASR APT.txt fields to airports table.
-- elevation: airport elevation in feet MSL (parsed from col 579)
-- ownershipType: ownership category code (PU, PR, MA, MR, MN, MK, CG)
-- airportUse: public or private use indicator (PU, PR)
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "elevation" INTEGER;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "ownershipType" VARCHAR(5);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "airportUse" VARCHAR(5);
