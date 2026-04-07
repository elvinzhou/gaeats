import type { SyncMessage } from "../../env";

interface ActionArgs {
  request: Request;
  context: { cloudflare: { env: Env; ctx: ExecutionContext } };
}

/**
 * POST /api/admin/sync
 *
 * Manually triggers sync jobs. Returns 202 immediately.
 * Requires `Authorization: Bearer <SYNC_SECRET>` header.
 *
 * Query params:
 *   - job=poi   enqueue poi-dispatch (fans out per-airport queue messages)
 *   - (omit)    same as job=poi
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

  if (jobParam && jobParam !== "poi") {
    return Response.json({ error: `Unknown job "${jobParam}". Use "poi".` }, { status: 400 });
  }

  const queued = new Date().toISOString();

  await env.SYNC_QUEUE.send({ job: "poi-dispatch" } satisfies SyncMessage);

  return Response.json({ status: "accepted", queued, poi: "dispatched" }, { status: 202 });
}
