import { describe, it, expect, vi, beforeEach } from "vitest";
import { loader } from "../api.airports.$code";

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
    vi.clearAllMocks();
    // Supress console.error in tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it("should return 500 when there is a database error", async () => {
    // Setup mock to throw error
    const { getAirportSummaryByCode } = await import("~/utils/postgis.server");
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

  it("should return 400 when airport code is missing", async () => {
    const request = new Request("http://localhost:3000/api/airports/");

    // Call loader with empty code
    const response = await loader({
      params: { code: " " },
      request,
      context: { cloudflare: { env: {} as any } },
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Invalid airport code");
  });

  it("should return 404 when airport is not found", async () => {
    const { getAirportSummaryByCode } = await import("~/utils/postgis.server");
    vi.mocked(getAirportSummaryByCode).mockResolvedValueOnce(null);

    const request = new Request("http://localhost:3000/api/airports/INVALID");

    const response = await loader({
      params: { code: "INVALID" },
      request,
      context: { cloudflare: { env: {} as any } },
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Airport not found");
  });

  it("should return 200 and data when successful", async () => {
    const { getAirportSummaryByCode } = await import("~/utils/postgis.server");
    const { findPoisNearAirport } = await import("~/utils/geospatial.server");

    const mockAirport = {
      code: "KSFO",
      name: "San Francisco International Airport",
      city: "San Francisco",
      state: "CA",
      country: "USA",
      latitude: 37.6213,
      longitude: -122.3790,
    };

    const mockPois = [
      { id: 1, name: "Restaurant 1", type: "RESTAURANT" }
    ];

    vi.mocked(getAirportSummaryByCode).mockResolvedValueOnce(mockAirport as any);
    vi.mocked(findPoisNearAirport).mockResolvedValueOnce(mockPois as any);

    const request = new Request("http://localhost:3000/api/airports/KSFO?distance=5.0&minRating=4.0&type=RESTAURANT");

    const response = await loader({
      params: { code: "KSFO" },
      request,
      context: { cloudflare: { env: {} as any } },
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.airport.code).toBe("KSFO");
    expect(data.pois).toHaveLength(1);
    expect(data.count).toBe(1);
    expect(data.search.radiusKm).toBe(5);
    expect(data.search.type).toBe("RESTAURANT");
  });
});
