/**
 * Environment Types for GA Eats
 * Extends the Cloudflare Workers Env interface with custom environment variables
 */

interface Env {
  DATABASE_URL: string;
  ENVIRONMENT: string;
  WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
}
