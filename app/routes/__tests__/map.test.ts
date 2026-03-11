import { describe, it, expect, vi, beforeEach } from "vitest";
import { loader } from "../map";
import * as geospatial from "~/utils/geospatial.server";

// Mock the geospatial utilities
vi.mock("~/utils/geospatial.server", () => ({
  findRestaurantsNearby: vi.fn(),
  findAttractionsNearby: vi.fn(),
  findAirportsNearby: vi.fn(),
}));

// Mock prisma
vi.mock("~/utils/db.server", () => ({
  prisma: {},
}));

describe("Map Route Loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty data and default center when database fetch fails", async () => {
    // Force findRestaurantsNearby to throw an error
    vi.mocked(geospatial.findRestaurantsNearby).mockRejectedValue(new Error("Database error"));

    const request = new Request("http://localhost/map");
    const result = await loader({ request, context: {}, params: {} } as any);

    expect(result).toEqual({
      pois: [],
      center: { lat: 39.8283, lng: -98.5795 },
      initialSelectedPoi: null,
      restaurants: 0,
      attractions: 0,
      airports: 0,
    });
  });

  it("should return empty data and requested center when database fetch fails with query params", async () => {
    // Force findAirportsNearby to throw an error
    vi.mocked(geospatial.findAirportsNearby).mockRejectedValue(new Error("Database error"));

    const lat = 40.7128;
    const lng = -74.0060;
    const request = new Request(`http://localhost/map?lat=${lat}&lng=${lng}`);
    const result = await loader({ request, context: {}, params: {} } as any);

    expect(result).toEqual({
      pois: [],
      center: { lat, lng },
      initialSelectedPoi: null,
      restaurants: 0,
      attractions: 0,
      airports: 0,
    });
  });
});
