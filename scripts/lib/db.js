import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

export function createScriptPrisma() {
  const directUrl = process.env.DIRECT_URL;
  const databaseUrl = process.env.DATABASE_URL;
  const resolvedUrl = directUrl ?? databaseUrl;

  if (!resolvedUrl) {
    throw new Error("Set DIRECT_URL or DATABASE_URL before running sync scripts.");
  }

  process.env.DATABASE_URL = resolvedUrl;
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: resolvedUrl,
    }),
  });
}
