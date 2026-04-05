/**
 * Deployment Smoke Tests
 *
 * Verifies that the deployed worker is responding correctly.
 * Run after every deployment:
 *
 *   BASE_URL=https://gaeats-app.workers.dev npm run test:smoke
 */

const BASE_URL = process.env.BASE_URL;

if (!BASE_URL) {
  console.error("BASE_URL environment variable is required");
  process.exit(1);
}

interface SmokeResult {
  name: string;
  passed: boolean;
  message?: string;
}

async function check(
  name: string,
  fn: () => Promise<void>
): Promise<SmokeResult> {
  try {
    await fn();
    return { name, passed: true };
  } catch (err) {
    return { name, passed: false, message: String(err) };
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function run() {
  const results: SmokeResult[] = await Promise.all([
    // -----------------------------------------------------------------------
    // Homepage loads
    // -----------------------------------------------------------------------
    check("GET / returns 200", async () => {
      const res = await fetch(`${BASE_URL}/`);
      assert(res.ok, `Expected 200, got ${res.status}`);
    }),

    // -----------------------------------------------------------------------
    // Security headers are present on every response
    // -----------------------------------------------------------------------
    check("Security headers present", async () => {
      const res = await fetch(`${BASE_URL}/`);
      const required = [
        "x-content-type-options",
        "x-frame-options",
        "referrer-policy",
        "strict-transport-security",
      ];
      for (const header of required) {
        assert(res.headers.has(header), `Missing header: ${header}`);
      }
    }),

    // -----------------------------------------------------------------------
    // CORS header present on API responses
    // -----------------------------------------------------------------------
    check("CORS header on API responses", async () => {
      const res = await fetch(
        `${BASE_URL}/api/airports/nearby?lat=37.77&lng=-122.41&distance=50`
      );
      assert(
        res.headers.has("access-control-allow-origin"),
        "Missing Access-Control-Allow-Origin header"
      );
    }),

    // -----------------------------------------------------------------------
    // CORS preflight returns 204
    // -----------------------------------------------------------------------
    check("OPTIONS preflight returns 204", async () => {
      const res = await fetch(`${BASE_URL}/api/airports/nearby`, {
        method: "OPTIONS",
      });
      assert(res.status === 204, `Expected 204, got ${res.status}`);
    }),

    // -----------------------------------------------------------------------
    // API: airports/nearby responds with expected shape
    // -----------------------------------------------------------------------
    check("GET /api/airports/nearby returns valid JSON", async () => {
      const res = await fetch(
        `${BASE_URL}/api/airports/nearby?lat=37.77&lng=-122.41&distance=50`
      );
      assert(res.ok, `Expected 200, got ${res.status}`);
      const json = (await res.json()) as Record<string, unknown>;
      assert("airports" in json, "Response missing 'airports' field");
      assert("count" in json, "Response missing 'count' field");
      assert("search" in json, "Response missing 'search' field");
    }),

    // -----------------------------------------------------------------------
    // API: pois/nearby responds with expected shape
    // -----------------------------------------------------------------------
    check("GET /api/pois/nearby returns valid JSON", async () => {
      const res = await fetch(
        `${BASE_URL}/api/pois/nearby?lat=37.77&lng=-122.41&distance=5&type=RESTAURANT`
      );
      assert(res.ok, `Expected 200, got ${res.status}`);
      const json = (await res.json()) as Record<string, unknown>;
      assert("pois" in json, "Response missing 'pois' field");
      assert("count" in json, "Response missing 'count' field");
    }),

    // -----------------------------------------------------------------------
    // API: airports/:code returns 400 on invalid code format
    // -----------------------------------------------------------------------
    check("GET /api/airports/:code rejects invalid code", async () => {
      const res = await fetch(`${BASE_URL}/api/airports/INVALID_CODE!!!`);
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      const json = (await res.json()) as Record<string, unknown>;
      assert(json.error === "Invalid airport code", "Wrong error message");
    }),

    // -----------------------------------------------------------------------
    // API: airports/:code returns 400 on bad distance
    // -----------------------------------------------------------------------
    check("GET /api/airports/:code validates distance", async () => {
      const res = await fetch(`${BASE_URL}/api/airports/KSFO?distance=9999`);
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    }),

    // -----------------------------------------------------------------------
    // API: airports/nearby returns 400 on missing params
    // -----------------------------------------------------------------------
    check("GET /api/airports/nearby requires lat/lng", async () => {
      const res = await fetch(`${BASE_URL}/api/airports/nearby`);
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    }),

    // -----------------------------------------------------------------------
    // API: restaurants/nearby responds with expected shape
    // -----------------------------------------------------------------------
    check("GET /api/restaurants/nearby returns valid JSON", async () => {
      const res = await fetch(
        `${BASE_URL}/api/restaurants/nearby?lat=37.77&lng=-122.41&distance=5`
      );
      assert(res.ok, `Expected 200, got ${res.status}`);
      const json = (await res.json()) as Record<string, unknown>;
      assert("restaurants" in json, "Response missing 'restaurants' field");
      assert("count" in json, "Response missing 'count' field");
    }),
  ]);

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);

  console.log(`\nSmoke tests: ${passed.length} passed, ${failed.length} failed\n`);

  for (const r of results) {
    const icon = r.passed ? "✓" : "✗";
    const detail = r.message ? `  → ${r.message}` : "";
    console.log(`  ${icon} ${r.name}${detail}`);
  }

  if (failed.length > 0) {
    process.exit(1);
  }
}

run();
