/**
 * Environment Types for GA Eats
 * Extends the auto-generated Env interface with custom environment variables
 */

declare global {
  /**
   * Cloudflare Workers Environment
   * Contains all environment variables and bindings available in the Worker
   */
  interface Env {
    /**
     * Prisma Accelerate connection string
     * Format: prisma://accelerate.prisma-data.net/?api_key=YOUR_API_KEY
     *
     * Set via:
     * - Production: `wrangler secret put DATABASE_URL`
     * - Local dev: .dev.vars file
     */
    DATABASE_URL: string;

    /**
     * Application environment
     * Defined in wrangler.jsonc vars
     */
    ENVIRONMENT: string;
  }
}

export {};
