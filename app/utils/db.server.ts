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
import { withAccelerate } from "@prisma/extension-accelerate";

/**
 * Creates a new Prisma Client instance
 */
function createPrismaClient(url?: string) {
  // Prisma 7+ with accelerate
  const finalUrl = url || "prisma+postgres://accelerate.prisma-data.net/?api_key=DUMMY";
  const client = new PrismaClient({ datasourceUrl: finalUrl } as any);
  return client.$extends(withAccelerate());
}

export type AppPrismaClient = any;

/**
 * Singleton Prisma Client instance
 * Created on first use and reused for all subsequent requests.
 */
export const prisma: AppPrismaClient = (globalThis as any).__prisma || ((globalThis as any).__prisma = createPrismaClient(process.env.DATABASE_URL));
