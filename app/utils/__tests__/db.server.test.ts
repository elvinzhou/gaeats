import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Prisma Client and Accelerate extension
// Variables used in vi.mock must start with 'mock' or be defined inside the factory
vi.mock("~/generated/prisma/client", () => {
  const MockPrismaClient = vi.fn().mockImplementation(function() {
    return {
      $extends: vi.fn().mockReturnValue({ isExtended: true }),
    };
  });
  return {
    PrismaClient: MockPrismaClient,
  };
});

vi.mock("@prisma/extension-accelerate", () => ({
  withAccelerate: vi.fn().mockReturnValue("mock-with-accelerate"),
}));

describe("db.server singleton", () => {
  const originalEnv = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete (globalThis as any).__prisma;
  });

  afterEach(() => {
    delete (globalThis as any).__prisma;
    process.env.DATABASE_URL = originalEnv;
  });

  it("should create a new Prisma instance and store it on globalThis", async () => {
    const { prisma } = await import("../db.server");

    expect(prisma).toBeDefined();
    expect(prisma.isExtended).toBe(true);
    expect((globalThis as any).__prisma).toBe(prisma);
  });

  it("should reuse the existing instance from globalThis", async () => {
    const mockPrisma = { isMock: true };
    (globalThis as any).__prisma = mockPrisma;

    const { prisma } = await import("../db.server");

    expect(prisma).toBe(mockPrisma);
  });

  it("should use DATABASE_URL if provided", async () => {
    process.env.DATABASE_URL = "postgres://custom-url";

    const { PrismaClient } = await import("~/generated/prisma/client");

    await import("../db.server");

    expect(PrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceUrl: "postgres://custom-url" })
    );
  });

  it("should use default dummy URL if DATABASE_URL is not provided", async () => {
    delete process.env.DATABASE_URL;

    const { PrismaClient } = await import("~/generated/prisma/client");

    await import("../db.server");

    expect(PrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({
        datasourceUrl: "prisma+postgres://accelerate.prisma-data.net/?api_key=DUMMY"
      })
    );
  });
});
