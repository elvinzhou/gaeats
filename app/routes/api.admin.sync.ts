import type { SyncMessage } from "../../env";

interface ActionArgs {
  request: Request;
  context: { cloudflare: { env: Env; ctx: ExecutionContext } };
}

/**
 * POST /api/admin/sync
 *
 * Enqueues a sync job and returns 202 immediately.
 * The queue consumer runs with a 5-minute CPU budget (vs. 30s for fetch).
 * Check Worker logs for completion / errors.
 *
 * Requires `Authorization: Bearer <SYNC_SECRET>` header.
 *
 * Optional query params:
 *   - job=faa        run only the FAA airport sync
 *   - job=poi        run only the Google POI sync
 *   - (omit)         run both
 *   - force=true     bypass the FAA staleness check
 */
export async function action({ request, context }: ActionArgs) {
  const { env } = context.cloudflare;

  if (!env.SYNC_SECRET) {
    return Response.json({ error: "Sync endpoint is not configured." }, { status: 503 });
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${env.SYNC_SECRET}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const jobParam = url.searchParams.get("job");
  const force = url.searchParams.get("force") === "true";

  if (jobParam && jobParam !== "faa" && jobParam !== "poi") {
    return Response.json({ error: `Unknown job "${jobParam}". Use "faa" or "poi".` }, { status: 400 });
  }

  const job: SyncMessage["job"] = (jobParam as SyncMessage["job"]) ?? "all";
  await env.SYNC_QUEUE.send({ job, force });

  return Response.json(
    { status: "accepted", job, force, queued: new Date().toISOString() },
    { status: 202 }
  );
}
