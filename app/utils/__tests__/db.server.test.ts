import { describe, it, expect, vi } from "vitest";
import { PrismaClient } from "~/generated/prisma/client";

vi.mock("@prisma/extension-accelerate", () => ({
  withAccelerate: vi.fn(() => ({})),
}));

vi.mock("~/generated/prisma/client", () => {
  const MockPrismaClient = vi.fn().mockImplementation(function(this: any) {
    this.$extends = vi.fn().mockReturnValue(this);
    return this;
  });
  return { PrismaClient: MockPrismaClient };
});

describe("db.server.ts", () => {
  it("should create a client with the given connection string", async () => {
    const { createPrisma } = await import("../db.server");
    const url = "prisma://accelerate.prisma-data.net/?api_key=test";

    createPrisma(url);

    expect(vi.mocked(PrismaClient)).toHaveBeenCalledWith({ accelerateUrl: url });
  });

  it("should create a new instance on each call", async () => {
    const { createPrisma } = await import("../db.server");
    const url = "prisma://accelerate.prisma-data.net/?api_key=test";

    const a = createPrisma(url);
    const b = createPrisma(url);

    expect(a).not.toBe(b);
  });
});
