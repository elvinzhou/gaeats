import { describe, it, expect, vi } from "vitest";
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
  it("should create a client with the given connection string", async () => {
    const { createPrisma } = await import("../db.server");
    const url = "postgresql://user:pass@db.supabase.co:5432/postgres";

    createPrisma(url);

    expect(vi.mocked(PrismaPg)).toHaveBeenCalledWith({ connectionString: url });
    expect(vi.mocked(PrismaClient)).toHaveBeenCalledWith({ adapter: expect.anything() });
  });

  it("should create a new instance on each call", async () => {
    const { createPrisma } = await import("../db.server");
    const url = "postgresql://user:pass@db.supabase.co:5432/postgres";

    const a = createPrisma(url);
    const b = createPrisma(url);

    expect(a).not.toBe(b);
  });
});
