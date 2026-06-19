-- TWR_TYPE_CODE in NASR APT_BASE.csv now carries compound values like
-- "ATCT-TRACON" (11 chars), exceeding the previous VarChar(10) limit.
ALTER TABLE "airports" ALTER COLUMN "controlTower" TYPE VARCHAR(20);
