// Standalone Gemini webhook manager — ZERO dependencies (Node 18+ built-in fetch).
//
// Registers (or lists / deletes) the webhook that notifies your collect endpoint
// when a Gemini batch job finishes. No .env file, no @google/genai, no
// node_modules required — pass the API key at runtime. The file uses no
// import/require, so it runs as either ESM or CommonJS (.js / .mjs / .cjs) and
// can be copied and run anywhere with Node 18+.
//
// Usage:
//   GEMINI_API_KEY=xxx node register-gemini-webhook.js --uri=https://<domain>/api/webhooks/gemini-batch [--name=NAME]
//   GEMINI_API_KEY=xxx node register-gemini-webhook.js --list
//   GEMINI_API_KEY=xxx node register-gemini-webhook.js --delete=WEBHOOK_ID
//
//   (You may pass --api-key=xxx instead of the env var, but the env var is
//    preferred so the key does not land in shell history / the process list.)
//
// On register the API returns the signing secret ONCE — store it as your
// worker's WEBHOOK_SIGNING_SECRET (e.g. `npx wrangler secret put WEBHOOK_SIGNING_SECRET`).

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const getArg = (prefix) => {
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
};

function printHelpAndExit() {
  console.log(`Gemini webhook manager (standalone, zero dependencies)

Usage:
  node register-gemini-webhook.js --uri=URL [--name=NAME]   Register a webhook
  node register-gemini-webhook.js --list                    List webhooks
  node register-gemini-webhook.js --delete=ID               Delete a webhook

Auth (one of):
  GEMINI_API_KEY env var (preferred)   or   --api-key=KEY

Options:
  --api-version=v1   REST API version (default: v1)
  --help, -h         Show this help`);
  process.exit(0);
}

async function main() {
  if (has("--help") || has("-h")) printHelpAndExit();

  const apiKey = getArg("--api-key=") ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Error: set GEMINI_API_KEY (or pass --api-key=KEY). See --help.");
    process.exit(1);
  }

  if (typeof fetch !== "function") {
    console.error("Error: global fetch is unavailable. Use Node 18+ (or run with --experimental-fetch).");
    process.exit(1);
  }

  const apiVersion = getArg("--api-version=") ?? "v1";
  const base = `https://generativelanguage.googleapis.com/${apiVersion}/webhooks`;

  const uri = getArg("--uri=");
  const name = getArg("--name=") ?? "gaeats-transient-collect";
  const deleteId = getArg("--delete=");

  async function api(method, path = "", body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "x-goog-api-key": apiKey,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} on ${method} ${base}${path}\n${text.slice(0, 600)}`);
    }
    return text ? JSON.parse(text) : {};
  }

  if (has("--list")) {
    const data = await api("GET");
    const webhooks = data.webhooks ?? [];
    if (webhooks.length === 0) {
      console.log("No webhooks registered.");
      return;
    }
    for (const w of webhooks) {
      const events = (w.subscribed_events ?? []).join(",") || "n/a";
      console.log(`- ${w.id ?? w.name}  ${w.uri}  events=${events}`);
    }
    return;
  }

  if (deleteId) {
    await api("DELETE", `/${encodeURIComponent(deleteId)}`);
    console.log(`Deleted webhook ${deleteId}`);
    return;
  }

  if (!uri) {
    console.error("Error: --uri=https://<domain>/api/webhooks/gemini-batch is required to register. See --help.");
    process.exit(1);
  }

  const webhook = await api("POST", "", {
    name,
    uri,
    subscribed_events: ["batch.succeeded", "batch.failed"],
  });

  console.log(`Registered webhook: ${webhook.id ?? webhook.name}`);
  console.log(`  uri:    ${uri}`);
  console.log(`  events: batch.succeeded, batch.failed`);
  console.log("");

  if (webhook.new_signing_secret) {
    console.log("Signing secret (shown ONCE — store it now):");
    console.log(`  ${webhook.new_signing_secret}`);
    console.log("");
    console.log("Store it on the Cloudflare Worker:");
    console.log("  npx wrangler secret put WEBHOOK_SIGNING_SECRET");
    console.log("  # (paste the secret above when prompted)");
  } else {
    console.warn("Warning: no signing secret returned. Run --list to inspect, or rotate the secret.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
