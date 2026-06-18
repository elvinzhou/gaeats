-- Ramp/FBO access point coordinates.
-- The FAA airport reference point (ARP) is the geometric center of the runway system,
-- which is often far from where pilots actually depart on foot or by vehicle.
-- These optional fields store a more accurate origin for travel-time calculations.
-- NULL means fall back to the ARP (airport.location).
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "rampLatitude" DOUBLE PRECISION;
ALTER TABLE "airports" ADD COLUMN IF NOT EXISTS "rampLongitude" DOUBLE PRECISION;
