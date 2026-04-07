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
     * Application environment
     * Defined in wrangler.jsonc vars
     */
    ENVIRONMENT: string;
  }
}

/** Message shape for the gaeats-sync queue. */
export interface SyncMessage {
  job: "faa" | "poi" | "all";
  force: boolean;
}
