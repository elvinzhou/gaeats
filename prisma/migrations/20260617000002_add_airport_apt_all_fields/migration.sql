-- Fix elevation to support decimal values (nearest tenth of a foot per FAA NASR spec)
ALTER TABLE "airports" ALTER COLUMN "elevation" TYPE DOUBLE PRECISION USING "elevation"::DOUBLE PRECISION;

-- Demographic / administrative fields
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "siteNumber" VARCHAR(11);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "faaRegionCode" VARCHAR(3);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "stateName" VARCHAR(20);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "countyName" VARCHAR(21);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "countyState" VARCHAR(2);

-- Ownership / management contact fields
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "ownerName" VARCHAR(35);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "ownerPhone" VARCHAR(16);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "managerName" VARCHAR(35);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "managerPhone" VARCHAR(16);

-- Geographic data fields
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "magVariation" VARCHAR(3);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "magVariationYear" VARCHAR(4);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "trafficPatternAltitude" INTEGER;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "sectionalChart" VARCHAR(30);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "distanceFromCity" INTEGER;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "directionFromCity" VARCHAR(3);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "acreage" INTEGER;

-- FAA services data
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "artccBoundaryId" VARCHAR(4);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "artccResponsibleId" VARCHAR(4);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "notamFacility" VARCHAR(4);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "notamDService" VARCHAR(1);

-- Federal status data
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "activationDate" VARCHAR(7);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "airportStatus" VARCHAR(2);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "arffCertification" VARCHAR(15);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "npiasAgreements" VARCHAR(7);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "airspaceAnalysis" VARCHAR(13);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "customsEntry" VARCHAR(1);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "customsLanding" VARCHAR(1);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "jointUse" VARCHAR(1);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "militaryRights" VARCHAR(1);

-- Airport services data
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "fuelTypes" VARCHAR(40);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "airframeRepair" VARCHAR(5);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "engineRepair" VARCHAR(5);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "bottledOxygen" VARCHAR(8);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "bulkOxygen" VARCHAR(8);

-- Airport facilities data
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "lightingSchedule" VARCHAR(7);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "beaconSchedule" VARCHAR(7);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "controlTower" VARCHAR(1);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "unicomFrequency" VARCHAR(7);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "ctafFrequency" VARCHAR(7);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "segmentedCircle" VARCHAR(4);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "beaconColor" VARCHAR(3);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "landingFee" VARCHAR(1);

-- Based aircraft counts
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "singleEngineCount" INTEGER;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "multiEngineCount" INTEGER;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "jetEngineCount" INTEGER;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "helicopterCount" INTEGER;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "gliderCount" INTEGER;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "militaryCount" INTEGER;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "ultralightCount" INTEGER;

-- Annual operations data
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "annualCommercialOps" INTEGER;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "annualCommuterOps" INTEGER;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "annualAirTaxiOps" INTEGER;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "annualGaLocalOps" INTEGER;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "annualGaItinerantOps" INTEGER;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "annualMilitaryOps" INTEGER;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "annualOpsDate" VARCHAR(10);

-- Additional airport information
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "contractFuel" VARCHAR(1);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "storageFacilities" VARCHAR(12);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "otherServices" VARCHAR(71);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "windIndicator" VARCHAR(3);
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "minOperationalNetwork" VARCHAR(1);
