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
 * Returns 202 immediately — the sync runs in the background via ctx.waitUntil().
 * Check Worker logs to confirm completion or see errors.
 *
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

  const url = new URL(request.url);
  const job = url.searchParams.get("job"); // "faa" | "poi" | null (= both)

  const jobs: Array<() => Promise<void>> = [];
  if (!job || job === "faa") jobs.push(() => refreshFaaAirportsIfStale({ env, ctx }));
  if (!job || job === "poi") jobs.push(() => refreshGooglePoiSyncIfDue({ env, ctx }));

  if (jobs.length === 0) {
    return Response.json({ error: `Unknown job "${job}". Use "faa" or "poi".` }, { status: 400 });
  }

  const started = new Date().toISOString();

  // Run in background — same pattern as the cron handler.
  // The FAA sync downloads and parses a large dataset that exceeds the CPU
  // budget of a synchronous fetch response. Check logs for completion/errors.
  ctx.waitUntil(
    (async () => {
      for (const run of jobs) {
        try {
          await run();
        } catch (err) {
          console.error(JSON.stringify({
            level: "error",
            message: "Manual sync failed",
            job,
            error: String(err),
            timestamp: new Date().toISOString(),
          }));
        }
      }
    })()
  );

  return Response.json({ started, status: "accepted", job: job ?? "all" }, { status: 202 });
}
