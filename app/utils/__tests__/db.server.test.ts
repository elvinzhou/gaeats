import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "~/generated/prisma/client";

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn().mockImplementation(function(this: any, opts: any) {
    this.connectionString = opts.connectionString;
  }),
}));

vi.mock("~/generated/prisma/client", () => {
  const MockPrismaClient = vi.fn().mockImplementation(function(this: any) {
    return this;
  });
  return { PrismaClient: MockPrismaClient };
});

describe("db.server.ts", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete (globalThis as any).__prisma;
  });

  it("should use DATABASE_URL if provided", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@db.supabase.co:5432/postgres";
    await import("../db.server");

    expect(vi.mocked(PrismaPg)).toHaveBeenCalledWith({ connectionString: process.env.DATABASE_URL });
    expect(vi.mocked(PrismaClient)).toHaveBeenCalledWith({ adapter: expect.anything() });
  });

  it("should throw an error if DATABASE_URL is missing", async () => {
    const originalUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(import("../db.server")).rejects.toThrow(
        "DATABASE_URL environment variable is required but not set."
      );
    } finally {
      process.env.DATABASE_URL = originalUrl;
    }
  });
});
