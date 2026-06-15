import { describe, it, expect, vi } from "vitest";
import { upsertFaaAirportWithLocation } from "./postgis.js";

/**
 * The airports table has unique constraints on code, faaCode, icaoCode and
 * iataCode, but `code` is derived (icaoCode || faaCode) and can change between
 * FAA editions. The previous `ON CONFLICT (code)` upsert crashed a re-import
 * when an existing row matched on faaCode/icaoCode under a different code
 * (duplicate key on airports_faaCode_key), which is why the scheduled FAA
 * import GitHub Action failed and never refreshed coordinates.
 *
 * upsertFaaAirportWithLocation now resolves the row by any stable identifier
 * and updates it in place, only inserting when genuinely new.
 */

const airport = {
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

// Tagged-template SQL arrives as a TemplateStringsArray in call[0].
const sqlOf = (call) => call[0].join(" ");

describe("upsertFaaAirportWithLocation", () => {
  it("updates the existing row in place when an identifier already matches", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 7 }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };

    await upsertFaaAirportWithLocation(prisma, airport, new Date());

    // Looks the row up by its stable identifiers (code/faaCode/icaoCode)...
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(sqlOf(prisma.$queryRaw.mock.calls[0])).toMatch(/SELECT id FROM "airports"/);
    // ...then UPDATEs in place instead of INSERTing, which would otherwise trip
    // the faaCode/icaoCode unique constraint and abort the import.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(sqlOf(prisma.$executeRaw.mock.calls[0])).toMatch(/UPDATE "airports"/);
  });

  it("inserts a new row when no identifier matches", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };

    await upsertFaaAirportWithLocation(prisma, airport, new Date());

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(sqlOf(prisma.$executeRaw.mock.calls[0])).toMatch(/INSERT INTO "airports"/);
  });
});
