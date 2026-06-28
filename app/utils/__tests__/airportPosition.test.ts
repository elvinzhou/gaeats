import { describe, it, expect } from "vitest";
import { airportMarkerPosition } from "../airportPosition";

describe("airportMarkerPosition", () => {
  it("uses the resolved transient ramp coordinate when present", () => {
    const pos = airportMarkerPosition({
      latitude: 37.6213, // ARP
      longitude: -122.379,
      rampLatitude: 37.625, // FBO / transient ramp
      rampLongitude: -122.372,
    });
    expect(pos).toEqual({ lat: 37.625, lng: -122.372 });
  });

  it("falls back to the airport reference point when no ramp is known", () => {
    const pos = airportMarkerPosition({
      latitude: 37.6213,
      longitude: -122.379,
      rampLatitude: null,
      rampLongitude: null,
    });
    expect(pos).toEqual({ lat: 37.6213, lng: -122.379 });
  });

  it("falls back when ramp fields are absent entirely", () => {
    const pos = airportMarkerPosition({ latitude: 40, longitude: -100 });
    expect(pos).toEqual({ lat: 40, lng: -100 });
  });

  it("does not treat a 0 ramp coordinate as missing", () => {
    // 0,0 is a valid (if unlikely) coordinate; only null/undefined means "unknown".
    const pos = airportMarkerPosition({
      latitude: 40,
      longitude: -100,
      rampLatitude: 0,
      rampLongitude: 0,
    });
    expect(pos).toEqual({ lat: 0, lng: 0 });
  });

  it("requires both ramp coordinates before relocating the marker", () => {
    const pos = airportMarkerPosition({
      latitude: 40,
      longitude: -100,
      rampLatitude: 41,
      rampLongitude: null,
    });
    expect(pos).toEqual({ lat: 40, lng: -100 });
  });
});
