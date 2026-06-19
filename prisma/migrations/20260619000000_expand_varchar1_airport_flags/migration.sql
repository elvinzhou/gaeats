-- The NASR APT_BASE.csv format has grown several flag fields beyond a single
-- character (e.g. TWR_TYPE_CODE now carries codes like "ATA", "ATCT").
-- Expand all VARCHAR(1) flag columns to VARCHAR(10) so imports don't fail.
ALTER TABLE "airports"
  ALTER COLUMN "notamDService"         TYPE VARCHAR(10),
  ALTER COLUMN "customsEntry"          TYPE VARCHAR(10),
  ALTER COLUMN "customsLanding"        TYPE VARCHAR(10),
  ALTER COLUMN "jointUse"              TYPE VARCHAR(10),
  ALTER COLUMN "militaryRights"        TYPE VARCHAR(10),
  ALTER COLUMN "controlTower"          TYPE VARCHAR(10),
  ALTER COLUMN "landingFee"            TYPE VARCHAR(10),
  ALTER COLUMN "contractFuel"          TYPE VARCHAR(10),
  ALTER COLUMN "minOperationalNetwork" TYPE VARCHAR(10);
