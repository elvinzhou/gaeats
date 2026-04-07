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
 *   - job=poi      enqueue poi-dispatch (fans out per-airport queue messages)
 *   - job=faa      start FaaSyncWorkflow (durable, checkpointed, paid plan only)
 *   - (omit)       both
 *   - force=true   bypass FAA staleness check
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

  const queued = new Date().toISOString();
  const result: Record<string, unknown> = { queued };

  if (!jobParam || jobParam === "poi") {
    await env.SYNC_QUEUE.send({ job: "poi-dispatch" } satisfies SyncMessage);
    result.poi = "dispatched";
  }

  if (!jobParam || jobParam === "faa") {
    const instance = await env.FAA_SYNC_WORKFLOW.create({ params: { force } });
    result.faa = { workflowInstanceId: instance.id };
  }

  return Response.json({ status: "accepted", ...result }, { status: 202 });
}
