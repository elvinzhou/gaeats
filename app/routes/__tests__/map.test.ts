import { describe, it, expect, vi, beforeEach } from "vitest";
import { loader } from "../map";
import * as geospatial from "~/utils/geospatial.server";
import * as postgis from "~/utils/postgis.server";

vi.mock("~/utils/geospatial.server", () => ({
  findRestaurantsNearby: vi.fn(),
  findAttractionsNearby: vi.fn(),
  findAirportsNearby: vi.fn(),
}));

vi.mock("~/utils/postgis.server", () => ({
  listAllAirports: vi.fn(),
}));

vi.mock("~/utils/db.server", () => ({
  createPrisma: vi.fn(() => ({})),
}));

describe("Map Route Loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty data and default center when database fetch fails", async () => {
    vi.mocked(postgis.listAllAirports).mockRejectedValue(new Error("Database error"));

    const request = new Request("http://localhost/map");
    const result = await loader({ request, context: { cloudflare: { env: {} } }, params: {} } as any);

    expect(result).toEqual({
      pois: [],
      center: { lat: 39.8283, lng: -98.5795 },
      zoom: 4,
      initialSelectedPoi: null,
      restaurants: 0,
      attractions: 0,
      airports: 0,
    });
  });

  it("should return empty data and requested center when database fetch fails with query params", async () => {
    vi.mocked(geospatial.findRestaurantsNearby).mockRejectedValue(new Error("Database error"));

    const lat = 40.7128;
    const lng = -74.006;
    const request = new Request(`http://localhost/map?lat=${lat}&lng=${lng}`);
    const result = await loader({ request, context: { cloudflare: { env: {} } }, params: {} } as any);

    expect(result).toEqual({
      pois: [],
      center: { lat, lng },
      zoom: 10,
      initialSelectedPoi: null,
      restaurants: 0,
      attractions: 0,
      airports: 0,
    });
  });
});
