import type { Route } from "./+types/api.airports.search";

interface AirportSearchResult {
  code: string;
  name: string;
  city: string;
  state: string | null;
  latitude: number;
  longitude: number;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";

  if (query.length < 2) {
    return Response.json({ results: [] as AirportSearchResult[] });
  }

  const { createPrisma } = await import("~/utils/db.server");
  const prisma = createPrisma(context.cloudflare.env.DATABASE_URL);

  const likeQuery = `%${query}%`;
  const codePrefix = `${query.toUpperCase()}%`;

  const results = await prisma.$queryRaw<AirportSearchResult[]>`
    SELECT
      code,
      name,
      city,
      state,
      ST_Y(location::geometry) as latitude,
      ST_X(location::geometry) as longitude
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

  return Response.json({ results });
}
