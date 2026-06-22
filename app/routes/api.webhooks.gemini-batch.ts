import type { Route } from "./+types/api.webhooks.gemini-batch";
import { verifyStandardWebhook } from "~/utils/standardWebhooks.server";

// Receives Gemini batch completion webhooks and dispatches the collect GitHub
// Actions workflow. Gemini signs each delivery with the Standard Webhooks
// scheme (webhook-id / webhook-timestamp / webhook-signature headers), verified
// here against WEBHOOK_SIGNING_SECRET — the signing secret returned when the
// webhook was registered (see scripts/register-gemini-webhook.js).
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const signingSecret = context.cloudflare.env.WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "WEBHOOK_SIGNING_SECRET is not configured",
        timestamp: new Date().toISOString(),
      })
    );
    return new Response("Server misconfigured", { status: 500 });
  }

  // Signature verification must run against the exact raw body.
  const payload = await request.text();

  const verified = await verifyStandardWebhook({
    secret: signingSecret,
    payload,
    headers: {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    },
  });

  if (!verified) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Standard Webhooks "thin" payload: { type, data: { id, output_file_uri? } }.
  let body: { type?: string; data?: { id?: string } };
  try {
    body = JSON.parse(payload);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const eventType = body.type ?? "";
  if (!["batch.succeeded", "batch.failed"].includes(eventType)) {
    return Response.json({ ok: true, ignored: true });
  }

  // Respond to Gemini immediately; dispatch GitHub Actions in the background.
  context.cloudflare.ctx.waitUntil(
    dispatchCollectWorkflow(context.cloudflare.env.GITHUB_TOKEN, eventType, body.data?.id)
  );

  return Response.json({ ok: true });
}

async function dispatchCollectWorkflow(
  githubToken: string,
  eventType: string,
  geminiJobName?: string
) {
  const resp = await fetch(
    "https://api.github.com/repos/elvinzhou/gaeats/actions/workflows/transient-sync-collect.yml/dispatches",
    {
      method: "POST",
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "gaeats-webhook-receiver",
      },
      // The collect script processes all PENDING jobs, so no inputs are needed.
      body: JSON.stringify({ ref: "main" }),
    }
  );

  if (!resp.ok) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "GitHub Actions dispatch failed",
        eventType,
        geminiJobName,
        status: resp.status,
        body: await resp.text(),
        timestamp: new Date().toISOString(),
      })
    );
  } else {
    console.log(
      JSON.stringify({
        level: "info",
        message: "Collect workflow dispatched",
        eventType,
        geminiJobName,
        timestamp: new Date().toISOString(),
      })
    );
  }
}
