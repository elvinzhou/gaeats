/**
 * Environment Types for GA Eats
 * Extends the Cloudflare Workers Env interface with custom environment variables
 */

declare global {
  /**
   * Cloudflare Workers Environment
   * Contains all environment variables and bindings available in the Worker
   */
  interface Env {
    /**
     * Direct Postgres connection string
     * Example: Supabase pooled or direct Postgres URL
     *
     * Set via:
     * - Production: `wrangler secret put DATABASE_URL`
     * - Local dev: .dev.vars file
     */
    DATABASE_URL: string;
    GOOGLE_MAPS_SERVER_API_KEY?: string;

    /**
     * Secret token required to manually trigger sync via POST /api/admin/sync.
     * Set via `wrangler secret put SYNC_SECRET`.
     * If unset, the endpoint returns 503.
     */
    SYNC_SECRET?: string;

    /**
     * Queue binding for dispatching sync jobs.
     * Declared in wrangler.jsonc queues.producers.
     * Create with: wrangler queues create gaeats-sync
     */
    SYNC_QUEUE: Queue<SyncMessage>;

    /**
     * Workflow binding for the durable FAA airport import.
     * Create with: wrangler workflows create gaeats-faa-sync FaaSyncWorkflow
     */
    FAA_SYNC_WORKFLOW: Workflow;

    /**
     * Application environment
     * Defined in wrangler.jsonc vars
     */
    ENVIRONMENT: string;
  }
}

/**
 * Message shapes for the gaeats-sync queue.
 *
 * poi-dispatch  Query due airports and enqueue one `poi` message per airport.
 *               Near-zero CPU — just a DB read + queue sends.
 *
 * poi           Process a single airport: fetch RESTAURANT + ATTRACTION places
 *               from Google, upsert POIs, update travel times.
 *               Designed to fit within the free-plan 10ms CPU budget since
 *               the work is almost entirely I/O (network + DB).
 *
 * FAA sync is handled by FaaSyncWorkflow (not the queue) — see env.FAA_SYNC_WORKFLOW.
 */
export type SyncMessage =
  | { job: "poi-dispatch" }
  | { job: "poi"; airportId: number };
