-- fuelTypes and otherServices are sourced from NASR APT_BASE.csv fields that
-- have grown beyond their original schema limits for larger commercial airports.
ALTER TABLE "airports"
  ALTER COLUMN "fuelTypes"       TYPE VARCHAR(100),
  ALTER COLUMN "otherServices"   TYPE VARCHAR(255),
  ALTER COLUMN "storageFacilities" TYPE VARCHAR(50);
