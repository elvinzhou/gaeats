import { describe, expect, it } from "vitest";
import { chooseNextPoiSyncAt } from "../sync-utils.server";

describe("chooseNextPoiSyncAt", () => {
  it("uses defaults when no options are provided (except empty object)", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    const next = chooseNextPoiSyncAt({ now });

    // Default airportCount = 1, desiredCycleDays = 30
    // dailyBatchSize = ceil(1/30) = 1
    // spacingDays = floor(30/1) = 30
    expect(next.toISOString()).toBe("2024-01-31T00:00:00.000Z");
  });

  it("calculates spacing correctly for multiple airports", () => {
    const now = new Date("2024-01-01T00:00:00Z");

    // 60 airports, 30 days cycle
    // dailyBatchSize = ceil(60/30) = 2
    // spacingDays = floor(30/2) = 15
    const next = chooseNextPoiSyncAt({
      now,
      airportCount: 60,
      desiredCycleDays: 30,
    });

    expect(next.toISOString()).toBe("2024-01-16T00:00:00.000Z");
  });

  it("respects minDays", () => {
    const now = new Date("2024-01-01T00:00:00Z");

    // 300 airports, 30 days cycle
    // dailyBatchSize = ceil(300/30) = 10
    // spacingDays = floor(30/10) = 3
    // But if we set minDays to 5:
    const next = chooseNextPoiSyncAt({
      now,
      airportCount: 300,
      desiredCycleDays: 30,
      minDays: 5,
    });

    expect(next.toISOString()).toBe("2024-01-06T00:00:00.000Z");
  });

  it("handles large desiredCycleDays (e.g. 1 year)", () => {
    const now = new Date("2024-01-01T00:00:00Z");

    // 10 airports, 365 days cycle
    // dailyBatchSize = ceil(10/365) = 1
    // spacingDays = floor(365/1) = 365
    const next = chooseNextPoiSyncAt({
      now,
      airportCount: 10,
      desiredCycleDays: 365,
    });

    // 2024 is a leap year, so 365 days from 2024-01-01 is 2024-12-31
    expect(next.toISOString()).toBe("2024-12-31T00:00:00.000Z");
  });
});
