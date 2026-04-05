import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the dependencies BEFORE importing the module
vi.mock("@prisma/extension-accelerate", () => ({
  withAccelerate: vi.fn(() => (client: any) => client),
}));

// We need to mock the generated prisma client because it might not be available or have issues in the test environment
vi.mock("~/generated/prisma/client", () => {
  const MockPrismaClient = vi.fn().mockImplementation(function(this: any, config: any) {
    this.config = config;
    this.$extends = vi.fn().mockReturnValue(this);
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
    process.env.DATABASE_URL = "prisma+postgres://real-url@accelerate.prisma-data.net";
    const { prisma } = await import("../db.server");

    expect(prisma.config.datasourceUrl).toBe(process.env.DATABASE_URL);
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
