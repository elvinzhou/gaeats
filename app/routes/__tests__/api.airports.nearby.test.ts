import { describe, it, expect, vi, beforeEach } from "vitest";
import { loader } from "../api.airports.nearby";
import * as geospatialServer from "~/utils/geospatial.server";

// Mock the geospatial module
vi.mock("~/utils/geospatial.server", () => ({
  findAirportsNearby: vi.fn(),
}));

describe("API Route: /api/airports/nearby", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 500 when database throws an error", async () => {
    // Mock the db function to throw
    vi.mocked(geospatialServer.findAirportsNearby).mockRejectedValue(new Error("Database connection failed"));

    // Prevent console.error from polluting the test output
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Create a mock request
    const request = new Request("http://localhost:3000/api/airports/nearby?lat=37.7749&lng=-122.4194&distance=50");
    const context = { cloudflare: { env: {} as any } };

    // Call the loader
    const response = await loader({ request, context } as any);

    // Verify response status
    expect(response.status).toBe(500);

    // Verify response JSON
    const data = await response.json();
    expect(data).toEqual({
      error: "Database error",
      message: "Failed to fetch airports. Please try again later.",
    });

    // Verify the mock was called
    expect(geospatialServer.findAirportsNearby).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });
});
