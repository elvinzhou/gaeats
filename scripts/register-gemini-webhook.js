import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

// One-time setup: register (or list / delete) the Gemini webhook that fires the
// transient-parking collect workflow when a batch job finishes.
//
// Usage:
//   node scripts/register-gemini-webhook.js --uri=https://<domain>/api/webhooks/gemini-batch [--name=NAME]
//   node scripts/register-gemini-webhook.js --list
//   node scripts/register-gemini-webhook.js --delete=WEBHOOK_ID
//
// On register, the API returns the signing secret EXACTLY ONCE. Store it as the
// WEBHOOK_SIGNING_SECRET secret on the Cloudflare Worker:
//   wrangler secret put WEBHOOK_SIGNING_SECRET

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log("Usage:");
  console.log("  node scripts/register-gemini-webhook.js --uri=URL [--name=NAME]   Register a webhook");
  console.log("  node scripts/register-gemini-webhook.js --list                    List webhooks");
  console.log("  node scripts/register-gemini-webhook.js --delete=ID               Delete a webhook");
  process.exit(0);
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required");

const getArg = (prefix) => [...args].find((a) => a.startsWith(prefix))?.slice(prefix.length);

const uri = getArg("--uri=");
const name = getArg("--name=") ?? "gaeats-transient-collect";
const deleteId = getArg("--delete=");
const list = args.has("--list");

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

if (list) {
  const res = await ai.webhooks.list();
  const webhooks = res.webhooks ?? [];
  if (webhooks.length === 0) {
    console.log("No webhooks registered.");
  } else {
    for (const w of webhooks) {
      console.log(`- ${w.id}  ${w.uri}  events=${(w.subscribed_events ?? []).join(",")}  state=${w.state ?? "n/a"}`);
    }
  }
  process.exit(0);
}

if (deleteId) {
  await ai.webhooks.delete(deleteId);
  console.log(`Deleted webhook ${deleteId}`);
  process.exit(0);
}

if (!uri) {
  throw new Error("--uri=https://<domain>/api/webhooks/gemini-batch is required to register");
}

const webhook = await ai.webhooks.create({
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
  console.log("Save it on the Cloudflare Worker:");
  console.log("  echo '<secret>' | wrangler secret put WEBHOOK_SIGNING_SECRET");
} else {
  console.warn("No signing secret returned. Use --list and rotate the secret if needed.");
}
