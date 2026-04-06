import { PrismaClient } from "~/generated/prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

export type AppPrismaClient = ReturnType<typeof createPrisma>;

export function createPrisma(connectionString: string) {
  return new PrismaClient({ accelerateUrl: connectionString }).$extends(
    withAccelerate()
  );
}
