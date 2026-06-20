import type { Route } from "./+types/api.webhooks.gemini-batch";

// Receives Gemini batch completion webhooks and dispatches the collect
// GitHub Actions workflow. Verified via a shared secret in the query string.
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  if (!secret || secret !== context.cloudflare.env.WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const eventType = (body.type ?? body.event_type ?? "") as string;

  if (!["batch.succeeded", "batch.failed"].includes(eventType)) {
    return Response.json({ ok: true, ignored: true });
  }

  // Respond to Gemini immediately; dispatch GitHub Actions in the background.
  context.cloudflare.ctx.waitUntil(
    dispatchCollectWorkflow(context.cloudflare.env.GITHUB_TOKEN, eventType)
  );

  return Response.json({ ok: true });
}

async function dispatchCollectWorkflow(githubToken: string, eventType: string) {
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
      body: JSON.stringify({ ref: "main" }),
    }
  );

  if (!resp.ok) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "GitHub Actions dispatch failed",
        eventType,
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
        timestamp: new Date().toISOString(),
      })
    );
  }
}
