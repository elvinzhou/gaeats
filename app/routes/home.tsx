/**
 * Home Route - GA Eats Landing Page
 *
 * This is the main landing page for the GA Eats application.
 * It will eventually include:
 * - Leaflet map showing airports and restaurants
 * - Search interface for finding fly-in dining locations
 * - Filter controls for distance, rating, cuisine type
 *
 * For now, it serves as a placeholder with basic information.
 */

import type { Route } from "./+types/home";
import { Link } from "react-router";

/**
 * Meta tags for SEO and social sharing
 */
export function meta({}: Route.MetaArgs) {
  return [
    { title: "GA Eats - Fly-in Dining Discovery" },
    {
      name: "description",
      content:
        "Discover the best fly-in dining locations. Find top-rated restaurants near airports across the country.",
    },
  ];
}

/**
 * Home page component
 * Displays welcome information and navigation links
 */
export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-100 to-white">
      <div className="container mx-auto px-4 py-16">
        {/* Header */}
        <header className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            GA Eats
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            The premier fly-in dining discovery engine for general aviation pilots.
            Find great food worth the flight.
          </p>
        </header>

        {/* Feature Cards */}
        <div className="grid md:grid-3 gap-8 max-w-4xl mx-auto mb-16">
          {/* Feature 1: Quality First */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="text-4xl mb-4">⭐</div>
            <h3 className="text-xl font-semibold mb-2">Quality First</h3>
            <p className="text-gray-600">
              Only restaurants rated 4.0+ stars. We filter for quality so you don't have to.
            </p>
          </div>

          {/* Feature 2: Transportation-Aware */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="text-4xl mb-4">🚗</div>
            <h3 className="text-xl font-semibold mb-2">Transportation-Aware</h3>
            <p className="text-gray-600">
              Know before you go: walkable, crew car available, or shuttle service.
            </p>
          </div>

          {/* Feature 3: Pilot-Verified */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="text-4xl mb-4">✈️</div>
            <h3 className="text-xl font-semibold mb-2">Pilot-Verified</h3>
            <p className="text-gray-600">
              Community-driven intel from pilots who've been there.
            </p>
          </div>
        </div>

        {/* Quick Links */}
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-semibold mb-4">Get Started</h2>
          <div className="flex justify-center gap-4">
            <Link
              to="/map"
              className="inline-block bg-blue-600 text-white px-8 py-4 rounded-lg hover:bg-blue-700 transition font-semibold text-lg"
            >
              🗺️ Open Interactive Map
            </Link>
            <Link
              to="/api/restaurants/nearby?lat=37.7749&lng=-122.4194&distance=5"
              className="inline-block bg-gray-200 text-gray-800 px-6 py-4 rounded-lg hover:bg-gray-300 transition"
            >
              📊 View API Example
            </Link>
          </div>
          <p className="text-sm text-gray-500 mt-4">
            🎉 New! Interactive map with Google Maps, satellite view, and multi-modal directions.
          </p>
        </div>

        {/* Architecture Note */}
        <div className="mt-16 bg-blue-50 border border-blue-200 rounded-lg p-6 max-w-2xl mx-auto">
          <h3 className="font-semibold text-blue-900 mb-2">🏗️ Architecture</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>✅ React Router v7 with Cloudflare Workers</li>
            <li>✅ Prisma v7 with Prisma Accelerate & Postgres</li>
            <li>✅ PostGIS for efficient geospatial queries</li>
            <li>✅ Edge caching with TTL & SWR strategies</li>
            <li>✅ Google Maps with satellite view & street view</li>
            <li>✅ Multi-modal directions (walk, bike, transit, drive)</li>
            <li>🔄 Background sync worker (pending)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
