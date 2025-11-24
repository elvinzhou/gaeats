/**
 * Prisma Configuration for GA Eats
 * Configures database connection URLs for migrations and client generation
 *
 * In Prisma v7, connection URLs are configured here instead of schema.prisma
 * - For migrations: uses DIRECT_URL (direct database connection)
 * - For runtime: PrismaClient uses DATABASE_URL (Prisma Accelerate)
 */
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Use direct database URL for migrations
    // This bypasses Prisma Accelerate and connects directly to PostgreSQL
    url: env("DIRECT_URL"),
  },
});
