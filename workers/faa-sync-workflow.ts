import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from "cloudflare:workers";

export type FaaSyncPayload = { force: boolean };

/**
 * FaaSyncWorkflow — durable two-step FAA airport import.
 *
 * Step 1 (check-staleness): DB query + NASR discovery API call.
 *   Fast, minimal CPU. Exits early if data is still fresh.
 *
 * Step 2 (import-airports): Downloads the NASR ZIP, streams-decompresses,
 *   and upserts ~20k airports. CPU-intensive — requires limits.cpu_ms: 300000
 *   (paid plan). If it fails partway, only this step is retried, not step 1.
 *
 * Trigger via: env.FAA_SYNC_WORKFLOW.create({ params: { force: false } })
 */
export class FaaSyncWorkflow extends WorkflowEntrypoint<Env, FaaSyncPayload> {
  async run(event: WorkflowEvent<FaaSyncPayload>, step: WorkflowStep) {
    const { force } = event.payload;

    const edition = await step.do("check-staleness", async () => {
      const { createPrisma } = await import("~/utils/db.server");
      const { checkFaaAirportStaleness } = await import("~/utils/faa-sync.server");
      return checkFaaAirportStaleness(createPrisma(this.env.DATABASE_URL), force);
    });

    if (!edition) return; // Data is fresh — nothing to do.

    await step.do(
      "import-airports",
      {
        retries: { limit: 2, delay: "1 minute", backoff: "exponential" },
        timeout: "10 minutes",
      },
      async () => {
        const { createPrisma } = await import("~/utils/db.server");
        const { importFaaAirports } = await import("~/utils/faa-sync.server");
        return importFaaAirports(edition.downloadUrl, edition.dataset, createPrisma(this.env.DATABASE_URL));
      }
    );
  }
}
