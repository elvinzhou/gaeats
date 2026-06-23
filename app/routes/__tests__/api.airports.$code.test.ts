import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loader } from "../api.airports.$code";
import { getAirportDetailByCode } from "~/utils/postgis.server";
import { findPoisNearAirport } from "~/utils/geospatial.server";

// Mock the utils
vi.mock("~/utils/db.server", () => ({
  prisma: {},
  createPrisma: vi.fn(() => ({})),
}));

vi.mock("~/utils/postgis.server", () => ({
  getAirportSummaryByCode: vi.fn(),
  getAirportDetailByCode: vi.fn(),
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
    vi.mocked(getAirportDetailByCode).mockRejectedValueOnce(new Error("Database connection failed"));

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

  it("should return transient parking info in the airport response", async () => {
    // Setup mock to resolve an airport including transient parking fields
    vi.mocked(getAirportDetailByCode).mockResolvedValueOnce({
      code: "KSFO",
      name: "San Francisco International Airport",
      city: "San Francisco",
      state: "CA",
      country: "US",
      latitude: 37.6213,
      longitude: -122.379,
      transientParkingNotes: "Transient parking on the south ramp.",
      transientParkingConfidence: "HIGH",
    } as any);
    vi.mocked(findPoisNearAirport).mockResolvedValueOnce([]);

    // Create a mock request
    const request = new Request("http://localhost:3000/api/airports/KSFO");

    // Call loader
    const response = await loader({
      params: { code: "KSFO" },
      request,
      context: { cloudflare: { env: {} as any } },
    });

    // Verify response
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.airport.transientParkingNotes).toBe("Transient parking on the south ramp.");
    expect(data.airport.transientParkingConfidence).toBe("HIGH");
  });
});
