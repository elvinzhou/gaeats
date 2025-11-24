/**
 * Unit Tests for Geospatial Utilities
 *
 * These tests verify the correctness of geospatial calculations
 * and utility functions used throughout the application.
 *
 * Test Coverage:
 * - Haversine distance calculations
 * - Distance formatting
 * - Coordinate validation
 */

import { describe, it, expect } from "vitest";
import {
  calculateHaversineDistance,
  formatDistance,
  type GeoPoint,
} from "../geospatial.server";

describe("Geospatial Utilities", () => {
  describe("calculateHaversineDistance", () => {
    /**
     * Test: Distance between San Francisco and Los Angeles
     * Expected: ~559 km (actual distance is approximately 559 km)
     */
    it("should calculate distance between San Francisco and Los Angeles", () => {
      const sanFrancisco: GeoPoint = {
        latitude: 37.7749,
        longitude: -122.4194,
      };
      const losAngeles: GeoPoint = {
        latitude: 34.0522,
        longitude: -118.2437,
      };

      const distance = calculateHaversineDistance(sanFrancisco, losAngeles);

      // Allow 1km margin of error due to floating point precision
      expect(distance).toBeGreaterThan(558);
      expect(distance).toBeLessThan(560);
    });

    /**
     * Test: Distance between New York and London
     * Expected: ~5570 km
     */
    it("should calculate distance between New York and London", () => {
      const newYork: GeoPoint = {
        latitude: 40.7128,
        longitude: -74.0060,
      };
      const london: GeoPoint = {
        latitude: 51.5074,
        longitude: -0.1278,
      };

      const distance = calculateHaversineDistance(newYork, london);

      // Allow 10km margin of error
      expect(distance).toBeGreaterThan(5560);
      expect(distance).toBeLessThan(5580);
    });

    /**
     * Test: Distance from a point to itself
     * Expected: 0 km
     */
    it("should return zero distance for the same point", () => {
      const point: GeoPoint = {
        latitude: 37.7749,
        longitude: -122.4194,
      };

      const distance = calculateHaversineDistance(point, point);

      expect(distance).toBe(0);
    });

    /**
     * Test: Distance across the equator
     * Expected: ~111 km (1 degree of latitude ≈ 111 km)
     */
    it("should calculate distance across the equator", () => {
      const point1: GeoPoint = {
        latitude: 0,
        longitude: 0,
      };
      const point2: GeoPoint = {
        latitude: 1,
        longitude: 0,
      };

      const distance = calculateHaversineDistance(point1, point2);

      // 1 degree of latitude is approximately 111 km
      expect(distance).toBeGreaterThan(110);
      expect(distance).toBeLessThan(112);
    });

    /**
     * Test: Distance across the prime meridian
     * Expected: ~111 km at the equator
     */
    it("should calculate distance across the prime meridian at equator", () => {
      const point1: GeoPoint = {
        latitude: 0,
        longitude: 0,
      };
      const point2: GeoPoint = {
        latitude: 0,
        longitude: 1,
      };

      const distance = calculateHaversineDistance(point1, point2);

      // 1 degree of longitude at the equator is approximately 111 km
      expect(distance).toBeGreaterThan(110);
      expect(distance).toBeLessThan(112);
    });

    /**
     * Test: Small distance calculation
     * Expected: ~1.4 km
     */
    it("should calculate small distances accurately", () => {
      const point1: GeoPoint = {
        latitude: 37.7749,
        longitude: -122.4194,
      };
      const point2: GeoPoint = {
        latitude: 37.7850,
        longitude: -122.4200,
      };

      const distance = calculateHaversineDistance(point1, point2);

      // Distance should be approximately 1.1-1.3 km
      expect(distance).toBeGreaterThan(1.0);
      expect(distance).toBeLessThan(1.5);
    });
  });

  describe("formatDistance", () => {
    /**
     * Test: Format distance less than 1 km
     * Expected: Display in meters
     */
    it("should format distances less than 1km in meters", () => {
      expect(formatDistance(500)).toBe("500 m");
      expect(formatDistance(999)).toBe("999 m");
      expect(formatDistance(100)).toBe("100 m");
    });

    /**
     * Test: Format distance greater than or equal to 1 km
     * Expected: Display in kilometers with 1 decimal place
     */
    it("should format distances >= 1km in kilometers", () => {
      expect(formatDistance(1000)).toBe("1.0 km");
      expect(formatDistance(1500)).toBe("1.5 km");
      expect(formatDistance(5432)).toBe("5.4 km");
      expect(formatDistance(10000)).toBe("10.0 km");
    });

    /**
     * Test: Format zero distance
     * Expected: "0 m"
     */
    it("should format zero distance correctly", () => {
      expect(formatDistance(0)).toBe("0 m");
    });

    /**
     * Test: Format very large distances
     * Expected: Display in kilometers
     */
    it("should format large distances correctly", () => {
      expect(formatDistance(100000)).toBe("100.0 km");
      expect(formatDistance(559000)).toBe("559.0 km");
    });

    /**
     * Test: Rounding behavior for meters
     * Expected: Round to nearest meter
     */
    it("should round meters correctly", () => {
      expect(formatDistance(499.4)).toBe("499 m");
      expect(formatDistance(499.5)).toBe("500 m");
      expect(formatDistance(499.6)).toBe("500 m");
    });

    /**
     * Test: Rounding behavior for kilometers
     * Expected: Round to 1 decimal place
     */
    it("should round kilometers to 1 decimal place", () => {
      expect(formatDistance(1234)).toBe("1.2 km");
      expect(formatDistance(1250)).toBe("1.3 km"); // 1.25 rounds to 1.3
      expect(formatDistance(1260)).toBe("1.3 km");
    });
  });
});
