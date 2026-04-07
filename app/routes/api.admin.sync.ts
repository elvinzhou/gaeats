import { refreshFaaAirportsIfStale } from "~/utils/faa-sync.server";
import { refreshGooglePoiSyncIfDue } from "~/utils/google-poi-sync.server";

interface ActionArgs {
  request: Request;
  context: { cloudflare: { env: Env; ctx: ExecutionContext } };
}

/**
 * POST /api/admin/sync
 *
 * Manually triggers the same sync jobs that run on the nightly cron.
 * Requires `Authorization: Bearer <SYNC_SECRET>` header.
 *
 * Optional query params:
 *   - job=faa       run only the FAA airport sync
 *   - job=poi       run only the Google POI sync
 *   - (omit job)    run both
 */
export async function action({ request, context }: ActionArgs) {
  const { env, ctx } = context.cloudflare;

  if (!env.SYNC_SECRET) {
    return Response.json({ error: "Sync endpoint is not configured." }, { status: 503 });
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${env.SYNC_SECRET}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const url = new URL(request.url);
  const job = url.searchParams.get("job"); // "faa" | "poi" | null (= both)

  const jobs: Array<() => Promise<void>> = [];
  if (!job || job === "faa") jobs.push(() => refreshFaaAirportsIfStale({ env, ctx }));
  if (!job || job === "poi") jobs.push(() => refreshGooglePoiSyncIfDue({ env, ctx }));

  if (jobs.length === 0) {
    return Response.json({ error: `Unknown job "${job}". Use "faa" or "poi".` }, { status: 400 });
  }

  const started = new Date().toISOString();
  const errors: string[] = [];

  for (const run of jobs) {
    try {
      await run();
    } catch (err) {
      errors.push(String(err));
    }
  }

  if (errors.length > 0) {
    return Response.json({ started, status: "error", errors }, { status: 500 });
  }

  return Response.json({ started, status: "ok", job: job ?? "all" });
}
