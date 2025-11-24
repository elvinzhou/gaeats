/**
 * Database Utility Module for GA Eats
 *
 * Provides a singleton Prisma Client with Prisma Accelerate extension
 * for connection pooling and edge caching.
 *
 * Usage:
 * ```typescript
 * import { prisma } from "~/utils/db.server";
 *
 * export async function loader({ context }: LoaderArgs) {
 *   const db = prisma(context.cloudflare.env.DATABASE_URL);
 *   const restaurants = await db.restaurant.findMany();
 *   return { restaurants };
 * }
 * ```
 */

import { PrismaClient } from "~/generated/prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

/**
 * Singleton Prisma Client instance
 * Created on first use and reused for all subsequent requests
 */
export const prisma = new PrismaClient({
    accelerateUrl: process.env.DATABASE_URL!,
  }).$extends(withAccelerate());