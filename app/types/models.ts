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
  name: string;
  city: string;
  state: string | null;
  country: string;
  latitude: number;
  longitude: number;
  distance?: number; // Distance in meters (from geospatial queries)
  createdAt: Date;
  updatedAt: Date;
}
