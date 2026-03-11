import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loader } from "../api.airports.$code";
import { getAirportSummaryByCode } from "~/utils/postgis.server";
import { findPoisNearAirport } from "~/utils/geospatial.server";

// Mock the utils
vi.mock("~/utils/db.server", () => ({
  prisma: {},
}));

vi.mock("~/utils/postgis.server", () => ({
  getAirportSummaryByCode: vi.fn(),
}));

vi.mock("~/utils/geospatial.server", () => ({
  findPoisNearAirport: vi.fn(),
}));

describe("API: Airport Details", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Supress console.error in tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 500 when there is a database error", async () => {
    // Setup mock to throw error
    vi.mocked(getAirportSummaryByCode).mockRejectedValueOnce(new Error("Database connection failed"));

    // Create a mock request
    const request = new Request("http://localhost:3000/api/airports/KSFO");

    // Call loader
    const response = await loader({
      params: { code: "KSFO" },
      request,
      context: { cloudflare: { env: {} as any } },
    });

    // Verify response
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data).toEqual({
      error: "Database error",
      message: "Failed to fetch airport data. Please try again later.",
    });
  });
});
