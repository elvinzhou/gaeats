import { createPrisma } from "~/utils/db.server";
import { findAccessiblePoisNearby } from "~/utils/geospatial.server";

interface LoaderArgs {
  request: Request;
  context: { cloudflare: { env: Env } };
}

export async function loader({ request, context }: LoaderArgs) {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat") ?? "");
  const lng = parseFloat(url.searchParams.get("lng") ?? "");
  const distance = parseFloat(url.searchParams.get("distance") ?? "50");
  const minRating = parseFloat(url.searchParams.get("minRating") ?? "4.0");
  const maxMinutes = parseInt(url.searchParams.get("maxMinutes") ?? "20", 10);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "60", 10), 100);

  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return Response.json({ error: "Invalid lat/lng" }, { status: 400 });
  }

  const db = createPrisma(context.cloudflare.env.DATABASE_URL);
  const pois = await findAccessiblePoisNearby(
    db,
    { latitude: lat, longitude: lng },
    Math.min(distance, 500),
    minRating,
    maxMinutes,
    limit
  );

  return Response.json({ pois });
}
