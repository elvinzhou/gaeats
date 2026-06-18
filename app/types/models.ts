/**
 * Type definitions for GA Eats domain models
 * These match the Prisma schema but are simplified for client-side use
 */

export interface Poi {
  id: number;
  externalSourceId: string | null;
  type: "RESTAURANT" | "ATTRACTION";
  name: string;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  cuisine: string | null;
  externalRating: number | null;
  pilotRating: number | null;
  address: string;
  city: string;
  state: string | null;
  country: string;
  latitude: number;
  longitude: number;
  distance?: number; // Distance in meters (from geospatial queries)
  createdAt: Date;
  updatedAt: Date;
}

export interface Airport {
  id: number;
  code: string;
  facilityType: string | null; // e.g. "AIRPORT", "HELIPORT", "SEAPLANE BASE"
  ownershipType: string | null; // PU, PR, MA, MR, MN, MK, CG
  airportUse: string | null; // PU=public, PR=private
  elevation: number | null; // feet MSL
  name: string;
  city: string;
  state: string | null;
  country: string;
  latitude: number;
  longitude: number;
  rampLatitude: number | null;
  rampLongitude: number | null;
  distance?: number; // Distance in meters (from geospatial queries)
  createdAt: Date;
  updatedAt: Date;
}
