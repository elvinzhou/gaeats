import "dotenv/config";

// One-time script to register the Gemini batch completion webhook.
// Run once after deploying the webhook endpoint.
//
// Usage:
//   WEBHOOK_URI=https://gaeats.example.com/api/webhooks/gemini-batch?secret=XXX \
//   node scripts/register-gemini-webhook.js

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const WEBHOOK_URI = process.env.WEBHOOK_URI;

if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required");
if (!WEBHOOK_URI) throw new Error("WEBHOOK_URI is required — include the ?secret= query param");

const WEBHOOK_ID = "transient-sync-batch";

const response = await fetch(
  `https://generativelanguage.googleapis.com/v1/webhooks?webhook_id=${WEBHOOK_ID}`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      name: "Transient Sync Batch Completion",
      uri: WEBHOOK_URI,
      subscribed_events: ["batch.succeeded", "batch.failed"],
    }),
  }
);

if (!response.ok) {
  const body = await response.text();
  throw new Error(`Gemini webhook registration failed: ${response.status} — ${body.slice(0, 300)}`);
}

const webhook = await response.json();
console.log("Webhook registered:");
console.log(JSON.stringify(webhook, null, 2));
console.log("\nStore the webhook name above if you need to update or delete it later.");
