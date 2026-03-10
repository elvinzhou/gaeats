/**
 * Prisma Configuration for GA Eats
 * Configures database connection URLs for migrations and client generation
 *
 * In Prisma v7, connection URLs are configured here instead of schema.prisma
 * - For migrations: uses DIRECT_URL (direct database connection)
 * - For runtime: PrismaClient uses DATABASE_URL (Prisma Accelerate)
 */
import "dotenv/config";
import { defineConfig } from "prisma/config";

const datasourceUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  ...(datasourceUrl
    ? {
        datasource: {
          // Prefer a direct database URL for migrations, but allow the runtime URL
          // so `prisma generate` works in environments without DIRECT_URL configured.
          url: datasourceUrl,
        },
      }
    : {}),
});
