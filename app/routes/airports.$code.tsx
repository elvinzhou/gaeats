import { prisma } from "~/utils/db.server";
import { findPoisNearAirport } from "~/utils/geospatial.server";
import { getAirportDetailByCode } from "~/utils/postgis.server";
import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/airports.$code";

export async function loader({ params, request }: Route.LoaderArgs) {
  const { code } = params;
  const url = new URL(request.url);
  const distance = parseFloat(url.searchParams.get("distance") || "5.0");
  const type = (url.searchParams.get("type") || "RESTAURANT") as "RESTAURANT" | "ATTRACTION";

  const airport = await getAirportDetailByCode(prisma, code);
  if (!airport) {
    throw new Response("Airport Not Found", { status: 404 });
  }

  const pois = await findPoisNearAirport(prisma, code, type, distance);

  return { airport, pois, distance, type };
}

export default function AirportPage() {
  const { airport, pois, distance, type } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-4 mb-2">
            <Link to="/" className="text-blue-600 hover:underline text-sm">← Back to Search</Link>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">{airport.code} - {airport.name}</h1>
          <p className="text-gray-600">{airport.city}, {airport.state} {airport.country}</p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row gap-8">
          {/* Sidebar / Filters */}
          <div className="w-full md:w-64 space-y-6">
            <section className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
              <h2 className="font-semibold mb-4 text-gray-900">Filters</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <div className="flex flex-col gap-2">
                    <Link 
                      to={`?type=RESTAURANT&distance=${distance}`}
                      className={`px-3 py-2 rounded-lg text-sm ${type === 'RESTAURANT' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                      🍴 Restaurants
                    </Link>
                    <Link 
                      to={`?type=ATTRACTION&distance=${distance}`}
                      className={`px-3 py-2 rounded-lg text-sm ${type === 'ATTRACTION' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                      🎡 Attractions
                    </Link>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Search Radius</label>
                  <select 
                    value={distance}
                    onChange={(e) => window.location.search = `?type=${type}&distance=${e.target.value}`}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="2">2 km</option>
                    <option value="5">5 km</option>
                    <option value="10">10 km</option>
                    <option value="20">20 km</option>
                  </select>
                </div>
              </div>
            </section>

            <section className="bg-blue-50 p-4 rounded-xl border border-blue-100">
              <h2 className="font-semibold mb-2 text-blue-900">Airport Info</h2>
              <div className="text-sm text-blue-800 space-y-2">
                {airport.fboName && <p><strong>FBO:</strong> {airport.fboName}</p>}
                {airport.fboPhone && <p><strong>Phone:</strong> {airport.fboPhone}</p>}
                {airport.notes && <p className="text-xs italic mt-2">{airport.notes}</p>}
              </div>
            </section>
          </div>

          {/* Main Content / POI List */}
          <div className="flex-1">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-gray-900">
                {type === 'RESTAURANT' ? 'Nearby Restaurants' : 'Nearby Attractions'}
                <span className="ml-2 text-sm font-normal text-gray-500">({pois.length} found)</span>
              </h2>
            </div>

            {pois.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center border-2 border-dashed border-gray-200">
                <p className="text-gray-500 mb-4">No results found within {distance}km.</p>
                <p className="text-sm text-gray-400">Try increasing the search radius or checking back later as we sync more data.</p>
              </div>
            ) : (
              <div className="grid gap-6">
                {pois.map((poi) => (
                  <div key={poi.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition">
                    <div className="p-6">
                      <div className="flex justify-between items-start gap-4 mb-2">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">{poi.name}</h3>
                          <p className="text-sm text-gray-500">{poi.category || poi.subcategory || 'Point of Interest'}</p>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-blue-600">
                            {poi.externalRating ? `⭐ ${poi.externalRating}` : 'No rating'}
                          </div>
                          <div className="text-xs text-gray-500">{poi.distance >= 1000 ? `${(poi.distance/1000).toFixed(1)}km` : `${Math.round(poi.distance)}m`} away</div>
                        </div>
                      </div>

                      <p className="text-gray-700 text-sm mb-4 line-clamp-2">{poi.description || poi.address}</p>

                      <div className="flex flex-wrap gap-2 mt-4">
                        {/* Reachability Badges */}
                        {poi.preferredMode === 'WALKING' && (
                          <span className="bg-green-100 text-green-800 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                            🚶 Walkable {poi.walkingMinutes ? `(${poi.walkingMinutes} min)` : ''}
                          </span>
                        )}
                        {poi.preferredMode === 'BIKING' && (
                          <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                            🚲 Bikeable {poi.bikingMinutes ? `(${poi.bikingMinutes} min)` : ''}
                          </span>
                        )}
                        {poi.preferredMode === 'TRANSIT' && (
                          <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                            🚌 Transit {poi.transitMinutes ? `(${poi.transitMinutes} min)` : ''}
                          </span>
                        )}
                        {poi.preferredMode === 'DRIVING' && (
                          <span className="bg-gray-100 text-gray-800 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                            🚗 {poi.needsRideshare ? 'Rideshare' : 'Driving'} {poi.drivingMinutes ? `(${poi.drivingMinutes} min)` : ''}
                          </span>
                        )}
                        {!poi.preferredMode && (
                          <span className="bg-yellow-50 text-yellow-700 text-xs font-medium px-2.5 py-1 rounded-full italic border border-yellow-100">
                            Reachability unknown (pending sync)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
