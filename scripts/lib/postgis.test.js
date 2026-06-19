import { describe, it, expect, vi } from "vitest";
import { upsertFaaAirportWithLocation } from "./postgis.js";

const base = {
  code: "PANC",
  faaCode: "ANC",
  icaoCode: "PANC",
  name: "Ted Stevens Anchorage Intl",
  city: "Anchorage",
  state: "AK",
  country: "US",
  sourceDataset: "faa-nasr-test",
  sourceRecordUpdatedAt: null,
  latitude: 61.1743,
  longitude: -149.9982,
};

function makePrisma() {
  return {
    airport: { upsert: vi.fn().mockResolvedValue({ id: 7 }) },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
}

// Tagged-template SQL arrives as a TemplateStringsArray in call[0].
const sqlOf = (call) => call[0].join(" ");

describe("upsertFaaAirportWithLocation", () => {
  it("uses faaCode as the upsert key when available", async () => {
    const prisma = makePrisma();
    await upsertFaaAirportWithLocation(prisma, base, new Date());

    const { where } = prisma.airport.upsert.mock.calls[0][0];
    expect(where).toEqual({ faaCode: "ANC" });
  });

  it("falls back to code as the upsert key when faaCode is absent", async () => {
    const prisma = makePrisma();
    await upsertFaaAirportWithLocation(prisma, { ...base, faaCode: null }, new Date());

    const { where } = prisma.airport.upsert.mock.calls[0][0];
    expect(where).toEqual({ code: "PANC" });
  });

  it("sets nextPoiSyncAt on create but not on update", async () => {
    const prisma = makePrisma();
    const nextPoiSyncAt = new Date("2026-07-01");
    await upsertFaaAirportWithLocation(prisma, base, nextPoiSyncAt);

    const { create, update } = prisma.airport.upsert.mock.calls[0][0];
    expect(create.nextPoiSyncAt).toBe(nextPoiSyncAt);
    expect(update.nextPoiSyncAt).toBeUndefined();
  });

  it("updates the PostGIS location via $executeRaw after the upsert", async () => {
    const prisma = makePrisma();
    await upsertFaaAirportWithLocation(prisma, base, new Date());

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const sql = sqlOf(prisma.$executeRaw.mock.calls[0]);
    expect(sql).toMatch(/UPDATE "airports" SET location = ST_GeomFromText/);
  });
});
