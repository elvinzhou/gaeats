import { describe, expect, it } from "vitest";
import { computeSignature, verifyStandardWebhook } from "../standardWebhooks.server";

// A throwaway base64 signing secret (whsec_ + base64("test-signing-secret")).
const SECRET = "whsec_dGVzdC1zaWduaW5nLXNlY3JldA==";
const ID = "msg_2abc";
const NOW = 1_700_000_000; // fixed "now" in seconds
const TIMESTAMP = String(NOW);
const PAYLOAD = JSON.stringify({ type: "batch.succeeded", data: { id: "batches/xyz" } });

async function signedHeader(payload = PAYLOAD, timestamp = TIMESTAMP, id = ID) {
  const sig = await computeSignature(SECRET, id, timestamp, payload);
  return `v1,${sig}`;
}

describe("verifyStandardWebhook", () => {
  it("accepts a correctly signed request", async () => {
    const ok = await verifyStandardWebhook({
      secret: SECRET,
      payload: PAYLOAD,
      headers: { id: ID, timestamp: TIMESTAMP, signature: await signedHeader() },
      nowSeconds: NOW,
    });
    expect(ok).toBe(true);
  });

  it("accepts when the header lists multiple space-delimited signatures", async () => {
    const valid = await signedHeader();
    const ok = await verifyStandardWebhook({
      secret: SECRET,
      payload: PAYLOAD,
      headers: { id: ID, timestamp: TIMESTAMP, signature: `v1,AAAAinvalid ${valid}` },
      nowSeconds: NOW,
    });
    expect(ok).toBe(true);
  });

  it("rejects a tampered payload", async () => {
    const ok = await verifyStandardWebhook({
      secret: SECRET,
      payload: JSON.stringify({ type: "batch.succeeded", data: { id: "batches/EVIL" } }),
      headers: { id: ID, timestamp: TIMESTAMP, signature: await signedHeader() },
      nowSeconds: NOW,
    });
    expect(ok).toBe(false);
  });

  it("rejects a signature made with a different secret", async () => {
    const sig = await computeSignature("whsec_b3RoZXItc2VjcmV0", ID, TIMESTAMP, PAYLOAD);
    const ok = await verifyStandardWebhook({
      secret: SECRET,
      payload: PAYLOAD,
      headers: { id: ID, timestamp: TIMESTAMP, signature: `v1,${sig}` },
      nowSeconds: NOW,
    });
    expect(ok).toBe(false);
  });

  it("rejects a stale timestamp outside the tolerance window (replay)", async () => {
    const ok = await verifyStandardWebhook({
      secret: SECRET,
      payload: PAYLOAD,
      headers: { id: ID, timestamp: TIMESTAMP, signature: await signedHeader() },
      nowSeconds: NOW + 6 * 60, // 6 minutes later, tolerance is 5
    });
    expect(ok).toBe(false);
  });

  it("rejects when required headers are missing", async () => {
    const base = {
      secret: SECRET,
      payload: PAYLOAD,
      nowSeconds: NOW,
    };
    const sig = await signedHeader();
    expect(
      await verifyStandardWebhook({ ...base, headers: { id: null, timestamp: TIMESTAMP, signature: sig } })
    ).toBe(false);
    expect(
      await verifyStandardWebhook({ ...base, headers: { id: ID, timestamp: null, signature: sig } })
    ).toBe(false);
    expect(
      await verifyStandardWebhook({ ...base, headers: { id: ID, timestamp: TIMESTAMP, signature: null } })
    ).toBe(false);
  });

  it("rejects an unsupported signature version", async () => {
    const sig = await computeSignature(SECRET, ID, TIMESTAMP, PAYLOAD);
    const ok = await verifyStandardWebhook({
      secret: SECRET,
      payload: PAYLOAD,
      headers: { id: ID, timestamp: TIMESTAMP, signature: `v2,${sig}` },
      nowSeconds: NOW,
    });
    expect(ok).toBe(false);
  });
});
