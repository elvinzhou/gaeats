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
     * Application environment
     * Defined in wrangler.jsonc vars
     */
    ENVIRONMENT: string;
  }
}

export {};
