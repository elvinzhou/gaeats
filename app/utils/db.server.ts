/**
 * Database Utility Module for GA Eats
 *
 * This module provides a centralized way to create and manage Prisma Client instances
 * with Prisma Accelerate extension for connection pooling and edge caching.
 *
 * Key Features:
 * - Connection pooling via Prisma Accelerate
 * - Edge caching with TTL and SWR strategies
 * - Type-safe database access
 * - Optimized for Cloudflare Workers runtime
 *
 * Usage:
 * ```typescript
 * import { createPrismaClient } from "~/utils/db.server";
 *
 * export async function loader({ context }) {
 *   const prisma = createPrismaClient(context.cloudflare.env.DATABASE_URL);
 *   const restaurants = await prisma.restaurant.findMany();
 *   return { restaurants };
 * }
 * ```
 *
 * @module db.server
 */

import { PrismaClient } from "~/generated/prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

/**
 * Creates a Prisma Client instance with Accelerate extension
 *
 * Prisma Accelerate provides:
 * - Automatic connection pooling (no cold starts)
 * - Global edge caching for faster queries
 * - Reduced database load through intelligent caching
 *
 * @param databaseUrl - Prisma Accelerate connection string
 *                      Format: prisma://accelerate.prisma-data.net/?api_key=YOUR_KEY
 * @returns PrismaClient extended with Accelerate capabilities
 *
 * @example
 * ```typescript
 * const prisma = createPrismaClient(env.DATABASE_URL);
 *
 * // Query with caching
 * const data = await prisma.restaurant.findMany({
 *   cacheStrategy: {
 *     ttl: 60,  // Fresh for 60 seconds
 *     swr: 120, // Serve stale for 120 seconds while revalidating
 *   },
 * });
 * ```
 */
export function createPrismaClient(databaseUrl: string) {
  // Initialize Prisma Client with the Accelerate connection string
  // The datasourceUrl overrides the default from schema.prisma
  const prisma = new PrismaClient({
    datasourceUrl: databaseUrl,

    // Optional: Enable query logging in development
    log: process.env.NODE_ENV === "development"
      ? ["query", "error", "warn"]
      : ["error"],
  });

  // Extend Prisma Client with Accelerate functionality
  // This adds caching capabilities to all queries
  return prisma.$extends(withAccelerate());
}

/**
 * Type for the extended Prisma Client
 * Use this for type annotations when passing the client around
 *
 * @example
 * ```typescript
 * function getRestaurants(db: PrismaClientWithAccelerate) {
 *   return db.restaurant.findMany();
 * }
 * ```
 */
export type PrismaClientWithAccelerate = ReturnType<typeof createPrismaClient>;

/**
 * Cache Strategy Presets
 * Common caching strategies for different use cases
 */
export const CacheStrategies = {
  /**
   * Short-term cache (1 minute)
   * Use for frequently changing data (e.g., real-time availability)
   */
  SHORT: {
    ttl: 60,
    swr: 120,
  },

  /**
   * Medium-term cache (5 minutes)
   * Use for semi-static data (e.g., restaurant lists)
   */
  MEDIUM: {
    ttl: 300,
    swr: 600,
  },

  /**
   * Long-term cache (30 minutes)
   * Use for static data (e.g., airport information)
   */
  LONG: {
    ttl: 1800,
    swr: 3600,
  },

  /**
   * No cache
   * Use for always-fresh data (e.g., user-specific queries)
   */
  NONE: undefined,
} as const;
