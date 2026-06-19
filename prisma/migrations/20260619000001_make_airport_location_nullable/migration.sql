-- Make location nullable so Prisma's typed upsert can create the row
-- before the PostGIS geometry is set in a follow-up $executeRaw.
ALTER TABLE "airports" ALTER COLUMN "location" DROP NOT NULL;
