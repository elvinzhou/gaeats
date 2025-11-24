/**
 * Type definitions for GA Eats domain models
 * These match the Prisma schema but are simplified for client-side use
 */

export interface Restaurant {
  id: number;
  googlePlaceId: string | null;
  name: string;
  description: string | null;
  cuisine: string | null;
  rating: number;
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
