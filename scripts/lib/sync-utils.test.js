import { describe, expect, it } from "vitest";
import {
  calculateDistanceMeters,
  chooseNextPoiSyncAt,
  derivePoiCategory,
  derivePoiSubcategory,
  normalizePoiType,
  sortAirportsForSync,
} from "./sync-utils.js";

describe("sync-utils", () => {
  it("calculates distance in meters", () => {
    const distance = calculateDistanceMeters(
      { latitude: 37.4611, longitude: -122.115 },
      { latitude: 37.5119, longitude: -122.2495 }
    );

    expect(distance).toBeGreaterThan(12000);
    expect(distance).toBeLessThan(14000);
  });

  it("derives category and subcategory from google place payloads", () => {
    const place = {
      primaryType: "restaurant",
      types: ["restaurant", "brunch_restaurant"],
    };

    expect(derivePoiCategory(place)).toBe("restaurant");
    expect(derivePoiSubcategory(place)).toBe("brunch_restaurant");
  });

  it("normalizes poi types", () => {
    expect(normalizePoiType("ATTRACTION")).toBe("ATTRACTION");
    expect(normalizePoiType("anything-else")).toBe("RESTAURANT");
  });

  it("chooses a future sync date", () => {
    const next = chooseNextPoiSyncAt({
      now: new Date("2026-03-09T00:00:00.000Z"),
      airportCount: 90,
      desiredCycleDays: 30,
    });

    expect(next.toISOString()).toBe("2026-03-19T00:00:00.000Z");
  });

  it("sorts airports by due time then priority", () => {
    const sorted = sortAirportsForSync([
      { code: "B", nextPoiSyncAt: "2026-03-12T00:00:00.000Z", syncPriority: 80 },
      { code: "A", nextPoiSyncAt: "2026-03-10T00:00:00.000Z", syncPriority: 120 },
      { code: "C", nextPoiSyncAt: "2026-03-10T00:00:00.000Z", syncPriority: 60 },
    ]);

    expect(sorted.map((airport) => airport.code)).toEqual(["C", "A", "B"]);
  });
});
