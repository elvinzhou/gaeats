import { describe, expect, it, vi } from "vitest";
import {
  getCurrentNasrEdition,
  mapNasrAptRecord,
  parseNasrCoordinate,
  parseNasrDate,
} from "./faa-utils.js";

describe("faa-utils", () => {
  it("normalizes NASR edition metadata from the FAA discovery API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          edition: [
            {
              editionDate: "03/19/2026",
              product: {
                url: "https://example.com/nasr.zip",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }
      )
    );

    await expect(getCurrentNasrEdition(fetchImpl)).resolves.toEqual({
      dataset: "faa-nasr-2026-03-19-apt",
      downloadUrl: "https://example.com/nasr.zip",
    });
  });

  it("parses FAA NASR DMS coordinates (packed form)", () => {
    expect(parseNasrCoordinate("374122.20N")).toBeCloseTo(37.6895, 4);
    expect(parseNasrCoordinate("1222257.40W")).toBeCloseTo(-122.3826, 4);
  });

  it("parses FAA NASR DMS coordinates (dash-separated form)", () => {
    // The real NASR APT.TXT "formatted" coordinates are dash-separated. These
    // must split on "-"; mis-parsing them as packed digits silently corrupted
    // every imported airport's location.
    expect(parseNasrCoordinate("37-41-22.20N")).toBeCloseTo(37.6895, 4);
    expect(parseNasrCoordinate("122-22-57.40W")).toBeCloseTo(-122.3826, 4);
    // Regression: Oakland Intl (KOAK) is 37-43-17N / 122-13-15W. The old parser
    // produced ~36.93 / ~-121.98 (clustered + shifted) for this exact input.
    expect(parseNasrCoordinate("37-43-17.0000N")).toBeCloseTo(37.7214, 3);
    expect(parseNasrCoordinate("122-13-15.0000W")).toBeCloseTo(-122.2208, 3);
  });

  it("parses FAA date formats used by APT records", () => {
    expect(parseNasrDate("03/19/2026")?.toISOString()).toBe("2026-03-19T00:00:00.000Z");
    expect(parseNasrDate("03192026")?.toISOString()).toBe("2026-03-19T00:00:00.000Z");
    expect(parseNasrDate("2026-03-19")?.toISOString()).toBe("2026-03-19T00:00:00.000Z");
  });

  it("maps APT.TXT fixed-width airport rows into canonical airport payloads", () => {
    const line = buildAptLine([
      [1, 3, "APT"],
      [14, 13, "AIRPORT"],
      [28, 4, "PAO"],
      [32, 10, "03/19/2026"],
      [49, 2, "CA"],
      [94, 40, "Palo Alto"],
      [134, 50, "Palo Alto Airport"],
      [184, 2, "PU"],   // ownershipType: publicly owned
      [186, 2, "PU"],   // airportUse: public use
      [524, 15, "37-46-28.0000N"],
      [551, 15, "122-06-54.0000W"],
      [579, 7, "7"],    // elevation: 7 feet MSL (Palo Alto is near sea level)
      [885, 8, "03182026"],
      [1211, 7, "KPAO"],
    ]);

    const record = mapNasrAptRecord(line, "faa-nasr-2026-03-19-apt");
    expect(record).toMatchObject({
      code: "KPAO",
      faaCode: "PAO",
      icaoCode: "KPAO",
      facilityType: "AIRPORT",
      ownershipType: "PU",
      airportUse: "PU",
      elevation: 7,
      city: "Palo Alto",
      state: "CA",
      source: "FAA",
      sourceDataset: "faa-nasr-2026-03-19-apt",
    });
    // Coordinates must be parsed from the dash-separated DMS fields.
    expect(record.latitude).toBeCloseTo(37.7744, 3);
    expect(record.longitude).toBeCloseTo(-122.115, 3);
  });

  it("rejects out-of-range or invalid values for ownershipType, airportUse, and elevation", () => {
    const line = buildAptLine([
      [1, 3, "APT"],
      [14, 13, "AIRPORT"],
      [28, 4, "TST"],
      [49, 2, "CA"],
      [94, 40, "Test City"],
      [134, 50, "Test Airport"],
      [184, 2, "XX"],   // invalid ownership type — should be null
      [186, 2, "ZZ"],   // invalid airport use — should be null
      [524, 15, "37-46-28.0000N"],
      [551, 15, "122-06-54.0000W"],
      [579, 7, "99999"], // elevation out of range — should be null
      [1211, 7, "KTST"],
    ]);

    const record = mapNasrAptRecord(line, null);
    expect(record?.ownershipType).toBeNull();
    expect(record?.airportUse).toBeNull();
    expect(record?.elevation).toBeNull();
  });
});

function buildAptLine(fields) {
  const chars = Array.from({ length: 1217 }, () => " ");

  for (const [start, length, value] of fields) {
    const padded = value.padEnd(length, " ");
    for (let index = 0; index < length; index += 1) {
      chars[start - 1 + index] = padded[index];
    }
  }

  return chars.join("");
}
