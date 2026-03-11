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

import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "~/generated/prisma/client";

export type AppPrismaClient = ReturnType<typeof createPrismaClient>;

function createPrismaClient() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL!,
  });
  const adapter = new PrismaPg(pool);

  return new PrismaClient({ adapter });
}

/**
 * Singleton Prisma Client instance
 * Created on first use and reused for all subsequent requests.
 */
export const prisma: AppPrismaClient = createPrismaClient();
