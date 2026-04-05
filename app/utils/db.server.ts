/**
 * Database Utility Module for GA Eats
 *
 * Provides a singleton Prisma Client using a direct Postgres connection.
 *
 * Usage:
 * ```typescript
 * import { prisma } from "~/utils/db.server";
 *
 * export async function loader({ context }: LoaderArgs) {
 *   const db = prisma;
 *   const restaurants = await db.restaurant.findMany();
 *   return { restaurants };
 * }
 * ```
 */

import { PrismaClient } from "~/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Creates a new Prisma Client instance
 */
function createPrismaClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required but not set.");
  }
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export type AppPrismaClient = PrismaClient;

/**
 * Singleton Prisma Client instance
 * Created on first use and reused for all subsequent requests.
 */
export const prisma: AppPrismaClient = (globalThis as any).__prisma || ((globalThis as any).__prisma = createPrismaClient());
