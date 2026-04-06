/**
 * Home Route - GA Eats Landing Page
 *
 * This is the main landing page for the GA Eats application.
 * It will eventually include:
 * - Airport-first search and discovery
 * - Last-mile access-aware POI discovery
 * - Filters for distance, mode, rating, and category
 *
 * For now, it serves as a placeholder with basic information.
 */

import type { Route } from "./+types/home";
import { Form, Link } from "react-router";

interface AirportSearchResult {
  code: string;
  name: string;
  city: string;
  state: string | null;
  country: string;
}

/**
 * Meta tags for SEO and social sharing
 */
export function meta({}: Route.MetaArgs) {
  return [
    { title: "GA Eats - Fly-in Dining Discovery" },
    {
      name: "description",
      content:
        "Discover worthwhile restaurants and attractions near general aviation airports across the country.",
    },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { createPrisma } = await import("~/utils/db.server");
  const prisma = createPrisma(context.cloudflare.env.DATABASE_URL);
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";

  if (query.length < 2) {
    return { query, results: [] as AirportSearchResult[] };
  }

  const likeQuery = `%${query}%`;
  const codePrefix = `${query.toUpperCase()}%`;

  const results = await prisma.$queryRaw<AirportSearchResult[]>`
    SELECT
      code,
      name,
      city,
      state,
      country
    FROM "airports"
    WHERE UPPER(code) LIKE ${codePrefix}
      OR name ILIKE ${likeQuery}
      OR city ILIKE ${likeQuery}
    ORDER BY
      CASE
        WHEN UPPER(code) = UPPER(${query}) THEN 0
        WHEN UPPER(code) LIKE ${codePrefix} THEN 1
        WHEN name ILIKE ${likeQuery} THEN 2
        ELSE 3
      END,
      name ASC
    LIMIT 8
  `;

  return { query, results };
}

/**
 * Home page component
 * Displays welcome information and navigation links
 */
export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <div className="min-h-screen bg-linear-to-b from-sky-100 to-white">
      <div className="container mx-auto px-4 py-16">
        {/* Header */}
        <header className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            GA Eats
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Airport-first discovery for general aviation pilots.
            Find worthwhile restaurants and attractions you can actually reach after landing.
          </p>
        </header>

        <section className="mx-auto mb-16 max-w-4xl rounded-3xl bg-white p-6 shadow-lg ring-1 ring-black/5">
          <div className="mb-4">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-500">
              Airport Search
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-gray-900">
              Search by airport code, name, or city
            </h2>
          </div>

          <Form method="get" className="flex flex-col gap-3 sm:flex-row">
            <input
              type="search"
              name="q"
              defaultValue={loaderData.query}
              placeholder="Try KPAO, Palo Alto, or San Carlos"
              className="flex-1 rounded-2xl border border-gray-300 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />
            <button
              type="submit"
              className="rounded-2xl bg-stone-950 px-6 py-3 text-base font-semibold text-white transition hover:bg-stone-800"
            >
              Search Airports
            </button>
          </Form>

          {loaderData.query.length >= 2 && (
            <div className="mt-6">
              <div className="mb-3 text-sm text-gray-600">
                {loaderData.results.length > 0
                  ? `Showing ${loaderData.results.length} airport result(s) for "${loaderData.query}"`
                  : `No airports found for "${loaderData.query}"`}
              </div>

              <div className="grid gap-3">
                {loaderData.results.map((airport: AirportSearchResult) => (
                  <Link
                    key={airport.code}
                    to={`/airports/${airport.code}`}
                    className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-left transition hover:border-gray-300 hover:bg-white hover:shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-lg font-semibold text-gray-900">
                          {airport.code}
                        </div>
                        <div className="text-sm text-gray-700">{airport.name}</div>
                      </div>
                      <div className="rounded-full bg-white px-3 py-1 text-sm font-medium text-gray-600 ring-1 ring-gray-200">
                        {airport.city}
                        {airport.state ? `, ${airport.state}` : ""}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Feature Cards */}
        <div className="grid md:grid-3 gap-8 max-w-4xl mx-auto mb-16">
          {/* Feature 1: Quality First */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="text-4xl mb-4">⭐</div>
            <h3 className="text-xl font-semibold mb-2">Trusted Defaults</h3>
            <p className="text-gray-600">
              Start with strong public data from sources like Google Maps, then layer pilot intel on top.
            </p>
          </div>

          {/* Feature 2: Transportation-Aware */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="text-4xl mb-4">🚗</div>
            <h3 className="text-xl font-semibold mb-2">Last-Mile Aware</h3>
            <p className="text-gray-600">
              Know whether a stop is walkable, bikeable, transit-friendly, rideshare-possible, or shuttle-supported.
            </p>
          </div>

          {/* Feature 3: Pilot-Verified */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="text-4xl mb-4">✈️</div>
            <h3 className="text-xl font-semibold mb-2">Pilot Overlay</h3>
            <p className="text-gray-600">
              Pilot reviews and access confirmations improve rankings without being required for baseline coverage.
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
              to="/airports/KSFO"
              className="inline-block bg-white text-gray-900 px-6 py-4 rounded-lg hover:bg-gray-100 transition border border-gray-300"
            >
              ✈️ View Airport Page
            </Link>
            <Link
              to="/api/pois/nearby?lat=37.7749&lng=-122.4194&distance=5&type=RESTAURANT"
              className="inline-block bg-gray-200 text-gray-800 px-6 py-4 rounded-lg hover:bg-gray-300 transition"
            >
              📊 View POI API
            </Link>
          </div>
          <p className="text-sm text-gray-500 mt-4">
            Interactive map with airport and POI discovery, public ratings, and multi-modal directions.
          </p>
        </div>

        {/* Architecture Note */}
        <div className="mt-16 bg-blue-50 border border-blue-200 rounded-lg p-6 max-w-2xl mx-auto">
          <h3 className="font-semibold text-blue-900 mb-2">🏗️ Architecture</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>✅ React Router v7 with Cloudflare Workers</li>
            <li>✅ Prisma v7 with Supabase Postgres</li>
            <li>✅ PostGIS for efficient geospatial queries</li>
            <li>✅ Canonical POI model for restaurants and attractions</li>
            <li>✅ Google Maps with satellite view and directions</li>
            <li>✅ Multi-modal directions (walk, bike, transit, drive)</li>
            <li>🔄 Access confidence and sync pipeline (pending)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
