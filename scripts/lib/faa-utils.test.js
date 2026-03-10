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

  it("parses FAA NASR DMS coordinates", () => {
    expect(parseNasrCoordinate("374122.20N")).toBeCloseTo(37.6895, 4);
    expect(parseNasrCoordinate("1222257.40W")).toBeCloseTo(-122.3826, 4);
  });

  it("parses FAA date formats used by APT records", () => {
    expect(parseNasrDate("03/19/2026")?.toISOString()).toBe("2026-03-19T00:00:00.000Z");
    expect(parseNasrDate("03192026")?.toISOString()).toBe("2026-03-19T00:00:00.000Z");
    expect(parseNasrDate("2026-03-19")?.toISOString()).toBe("2026-03-19T00:00:00.000Z");
  });

  it("maps APT.TXT fixed-width airport rows into canonical airport payloads", () => {
    const line = buildAptLine([
      [1, 3, "APT"],
      [28, 4, "PAO"],
      [32, 10, "03/19/2026"],
      [49, 2, "CA"],
      [94, 40, "Palo Alto"],
      [134, 50, "Palo Alto Airport"],
      [524, 15, "374628.00N"],
      [551, 15, "1220654.00W"],
      [885, 8, "03182026"],
      [1211, 7, "KPAO"],
    ]);

    expect(mapNasrAptRecord(line, "faa-nasr-2026-03-19-apt")).toMatchObject({
      code: "KPAO",
      faaCode: "PAO",
      icaoCode: "KPAO",
      city: "Palo Alto",
      state: "CA",
      source: "FAA",
      sourceDataset: "faa-nasr-2026-03-19-apt",
    });
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
