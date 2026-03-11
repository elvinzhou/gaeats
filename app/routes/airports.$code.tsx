import { Link } from "react-router";
import type { Route } from "./+types/airports.$code";
import { prisma } from "~/utils/db.server";
import { getAirportDetailByCode, type AirportDetailRow } from "~/utils/postgis.server";

type PoiType = "RESTAURANT" | "ATTRACTION";

interface AccessFact {
  mode: string;
  status: "YES" | "NO" | "LIMITED" | "UNKNOWN";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  note: string | null;
  lastVerifiedAt: Date | null;
}

interface AirportPoiMetrics {
  poiId: number;
  straightLineDistanceMeters: number | null;
  walkingMinutes: number | null;
  bikingMinutes: number | null;
  transitMinutes: number | null;
  drivingMinutes: number | null;
  preferredMode: string | null;
  accessConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
}

export function meta({ data }: Route.MetaArgs) {
  const airport = data?.airport;

  if (!airport) {
    return [{ title: "Airport - GA Eats" }];
  }

  return [
    { title: `${airport.code} - ${airport.name} | GA Eats` },
    {
      name: "description",
      content: `Explore restaurants and attractions near ${airport.code} with last-mile access context.`,
    },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { findPoisNearby } = await import("~/utils/geospatial.server");
  const code = params.code?.trim();

  if (!code) {
    throw new Response("Airport code is required", { status: 400 });
  }

  const url = new URL(request.url);
  const distance = clampNumber(url.searchParams.get("distance"), 5, 1, 100);
  const minRating = clampNumber(url.searchParams.get("minRating"), 4, 0, 5);
  const requestedType = parseType(url.searchParams.get("type"));

  const airport: AirportDetailRow | null = await getAirportDetailByCode(prisma, code);

  if (!airport) {
    throw new Response("Airport not found", { status: 404 });
  }

  const [restaurants, attractions, accessFacts] = await Promise.all([
    findPoisNearby(prisma, airport, "RESTAURANT", distance, minRating),
    findPoisNearby(prisma, airport, "ATTRACTION", distance, minRating),
    prisma.airportAccessFact.findMany({
      where: { airportId: airport.id },
      orderBy: [{ confidence: "asc" }, { mode: "asc" }],
      select: {
        mode: true,
        status: true,
        confidence: true,
        note: true,
        lastVerifiedAt: true,
      },
    }),
  ]);

  const airportPoiMetrics = await prisma.airportPoi.findMany({
    where: {
      airportId: airport.id,
      poiId: {
        in: [...restaurants, ...attractions].map((poi) => poi.id),
      },
    },
    select: {
      poiId: true,
      straightLineDistanceMeters: true,
      walkingMinutes: true,
      bikingMinutes: true,
      transitMinutes: true,
      drivingMinutes: true,
      preferredMode: true,
      accessConfidence: true,
    },
  });

  const metricsByPoiId = new Map<number, AirportPoiMetrics>(
    airportPoiMetrics.map((metric) => [metric.poiId, metric])
  );

  return {
    airport,
    selectedType: requestedType,
    distance,
    minRating,
    restaurants: restaurants.map((poi) => ({
      ...poi,
      routeMetrics: metricsByPoiId.get(poi.id) ?? null,
    })),
    attractions: attractions.map((poi) => ({
      ...poi,
      routeMetrics: metricsByPoiId.get(poi.id) ?? null,
    })),
    accessFacts,
  };
}

export default function AirportDetailRoute({ loaderData }: Route.ComponentProps) {
  const { airport, selectedType, distance, minRating, restaurants, attractions, accessFacts } =
    loaderData;

  const selectedPois = selectedType === "RESTAURANT" ? restaurants : attractions;

  return (
    <main className="min-h-screen bg-stone-50 text-stone-900">
      <section className="border-b border-stone-200 bg-[linear-gradient(135deg,#f7f0df_0%,#f2f7f5_45%,#e5eef7_100%)]">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-stone-600">
            <Link to="/" className="hover:text-stone-900">
              Home
            </Link>
            <span>/</span>
            <Link to="/map" className="hover:text-stone-900">
              Map
            </Link>
            <span>/</span>
            <span>{airport.code}</span>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1.7fr_1fr]">
            <div>
              <div className="mb-4 flex flex-wrap items-end gap-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-stone-500">
                    Airport Brief
                  </p>
                  <h1 className="text-4xl font-semibold tracking-tight">
                    {airport.code}
                  </h1>
                </div>
                <div className="rounded-full bg-white/80 px-3 py-1 text-sm font-medium text-stone-700 shadow-sm ring-1 ring-stone-200">
                  {airport.city}
                  {airport.state ? `, ${airport.state}` : ""}
                </div>
              </div>

              <p className="max-w-3xl text-lg text-stone-700">{airport.name}</p>

              <div className="mt-6 flex flex-wrap gap-2">
                {accessFacts.length > 0 ? (
                  accessFacts.map((fact) => (
                    <span
                      key={fact.mode}
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${accessBadgeClass(
                        fact.status,
                        fact.confidence
                      )}`}
                      title={fact.note ?? undefined}
                    >
                      {formatMode(fact.mode)}: {formatStatus(fact.status)} ·{" "}
                      {formatFreshness(fact.lastVerifiedAt)}
                    </span>
                  ))
                ) : (
                  <span className="rounded-full bg-stone-200 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-stone-700">
                    No access confirmations yet
                  </span>
                )}
              </div>
            </div>

            <aside className="rounded-3xl bg-stone-950 p-6 text-stone-50 shadow-xl">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-stone-400">
                Planning Snapshot
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <MetricCard label="Restaurants" value={String(restaurants.length)} />
                <MetricCard label="Attractions" value={String(attractions.length)} />
                <MetricCard label="Radius" value={`${distance} km`} />
                <MetricCard label="Min Rating" value={minRating.toFixed(1)} />
              </div>
              {airport.fboName && (
                <div className="mt-6 rounded-2xl bg-white/10 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
                    FBO
                  </div>
                  <div className="mt-2 text-lg font-medium">{airport.fboName}</div>
                  {airport.fboPhone && (
                    <div className="mt-1 text-sm text-stone-300">{airport.fboPhone}</div>
                  )}
                  {airport.fboWebsite && (
                    <a
                      href={airport.fboWebsite}
                      className="mt-3 inline-block text-sm text-amber-300 hover:text-amber-200"
                    >
                      Visit FBO website
                    </a>
                  )}
                </div>
              )}
            </aside>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Nearby POIs</h2>
            <p className="text-sm text-stone-600">
              Start with public ratings, then layer in last-mile and pilot access context.
            </p>
          </div>

          <div className="flex rounded-full bg-white p-1 shadow-sm ring-1 ring-stone-200">
            <TypeLink
              airportCode={airport.code}
              currentType={selectedType}
              nextType="RESTAURANT"
              distance={distance}
              minRating={minRating}
              count={restaurants.length}
            />
            <TypeLink
              airportCode={airport.code}
              currentType={selectedType}
              nextType="ATTRACTION"
              distance={distance}
              minRating={minRating}
              count={attractions.length}
            />
          </div>
        </div>

        {airport.notes && (
          <div className="mb-8 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
              Airport Notes
            </div>
            <p className="mt-3 text-sm leading-6 text-stone-700">{airport.notes}</p>
          </div>
        )}

        {selectedPois.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-stone-300 bg-white p-10 text-center">
            <h3 className="text-xl font-semibold">No {selectedType.toLowerCase()}s found</h3>
            <p className="mt-2 text-sm text-stone-600">
              Try a wider radius or lower rating threshold once filters are exposed in the UI.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {selectedPois.map((poi) => (
              <article
                key={`${selectedType}-${poi.id}`}
                className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-stone-600">
                        {poi.type}
                      </span>
                      {poi.category && (
                        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
                          {poi.category}
                        </span>
                      )}
                    </div>
                    <h3 className="text-xl font-semibold">{poi.name}</h3>
                    <p className="mt-1 text-sm text-stone-600">
                      {poi.address}, {poi.city}
                      {poi.state ? `, ${poi.state}` : ""}
                    </p>
                    {poi.description && (
                      <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-700">
                        {poi.description}
                      </p>
                    )}
                  </div>

                  <div className="rounded-2xl bg-stone-50 px-4 py-3 text-right ring-1 ring-stone-200">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                      Public Rating
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {poi.externalRating?.toFixed(1) ?? "N/A"}
                    </div>
                    <div className="mt-2 text-sm text-stone-600">
                      {formatDistanceLocal(poi.distance)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4 text-sm text-stone-600">
                  <div>
                    <div className="font-medium text-stone-800">Last-mile summary</div>
                    <div>{formatRouteSummary(poi.routeMetrics, poi.distance)}</div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Link
                      to={`/map?lat=${airport.latitude}&lng=${airport.longitude}&radius=${distance}&poiId=${poi.id}&poiType=${poi.type.toLowerCase()}`}
                      className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 transition-colors hover:border-stone-400 hover:bg-stone-100"
                    >
                      Open on map
                    </Link>
                    {poi.routeMetrics?.accessConfidence && (
                      <span
                        className={`rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-wide ${confidencePillClass(
                          poi.routeMetrics.accessConfidence
                        )}`}
                      >
                        {poi.routeMetrics.accessConfidence.toLowerCase()} confidence
                      </span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/10 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function TypeLink({
  airportCode,
  currentType,
  nextType,
  distance,
  minRating,
  count,
}: {
  airportCode: string;
  currentType: PoiType;
  nextType: PoiType;
  distance: number;
  minRating: number;
  count: number;
}) {
  const isActive = currentType === nextType;
  const label = nextType === "RESTAURANT" ? "Restaurants" : "Attractions";

  return (
    <Link
      to={`/airports/${airportCode}?type=${nextType}&distance=${distance}&minRating=${minRating}`}
      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
        isActive ? "bg-stone-950 text-white" : "text-stone-600 hover:text-stone-900"
      }`}
    >
      {label} ({count})
    </Link>
  );
}

function clampNumber(
  value: string | null,
  fallback: number,
  min: number,
  max: number
) {
  const parsed = Number.parseFloat(value ?? "");

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function parseType(value: string | null): PoiType {
  return value === "ATTRACTION" ? "ATTRACTION" : "RESTAURANT";
}

function formatMode(mode: string) {
  return mode.replaceAll("_", " ").toLowerCase();
}

function formatStatus(status: string) {
  return status.toLowerCase();
}

function accessBadgeClass(
  status: AccessFact["status"],
  confidence: AccessFact["confidence"]
) {
  if (status === "YES" && confidence === "HIGH") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "LIMITED" || confidence === "MEDIUM") {
    return "bg-amber-100 text-amber-800";
  }

  if (status === "NO") {
    return "bg-rose-100 text-rose-800";
  }

  return "bg-stone-200 text-stone-700";
}

function formatDistanceLocal(distanceMeters: number) {
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }

  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function formatFreshness(value: Date | null) {
  if (!value) {
    return "not verified";
  }

  const ageDays = Math.floor(
    (Date.now() - new Date(value).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (ageDays <= 90) return "fresh";
  if (ageDays <= 180) return "aging";
  if (ageDays <= 365) return "stale";
  return "old";
}

function formatRouteSummary(
  metrics: AirportPoiMetrics | null,
  fallbackDistance: number
) {
  if (!metrics) {
    return `Straight-line distance ${formatDistanceLocal(fallbackDistance)}. Route timing not calculated yet.`;
  }

  const options = [
    metrics.walkingMinutes ? `${metrics.walkingMinutes} min walk` : null,
    metrics.bikingMinutes ? `${metrics.bikingMinutes} min bike` : null,
    metrics.transitMinutes ? `${metrics.transitMinutes} min transit` : null,
    metrics.drivingMinutes ? `${metrics.drivingMinutes} min drive` : null,
  ].filter(Boolean);

  if (options.length === 0) {
    return `Straight-line distance ${formatDistanceLocal(
      metrics.straightLineDistanceMeters ?? fallbackDistance
    )}. Route timing not calculated yet.`;
  }

  const preferredMode = metrics.preferredMode
    ? `Preferred: ${formatMode(metrics.preferredMode)}. `
    : "";

  return `${preferredMode}${options.join(" · ")}`;
}

function confidencePillClass(
  confidence: NonNullable<AirportPoiMetrics["accessConfidence"]>
) {
  switch (confidence) {
    case "HIGH":
      return "bg-emerald-100 text-emerald-800";
    case "MEDIUM":
      return "bg-amber-100 text-amber-800";
    case "LOW":
      return "bg-stone-200 text-stone-700";
  }
}
