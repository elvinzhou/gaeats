/**
 * Environment Types for GA Eats
 * Extends the Cloudflare Workers Env interface with custom environment variables
 */

interface Env {
  DATABASE_URL: string;
  ENVIRONMENT: string;
  // Signing secret from the registered Gemini webhook (webhook.new_signing_secret),
  // used to verify Standard Webhooks signatures on batch completion callbacks.
  WEBHOOK_SIGNING_SECRET: string;
  GITHUB_TOKEN: string;
}
