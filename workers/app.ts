import { createRequestHandler } from "react-router";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

// ---------------------------------------------------------------------------
// Security headers applied to every response
// ---------------------------------------------------------------------------
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

// CORS – public read-only API; tighten to a specific origin for production if needed.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ---------------------------------------------------------------------------
// In-process rate limiter (per-IP, per worker isolate)
// Provides basic burst protection. Configure Cloudflare Rate Limiting rules
// in the dashboard for distributed enforcement across all edge nodes.
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60;           // requests per window per IP

interface RateEntry { count: number; windowStart: number }
const rateLimitMap = new Map<string, RateEntry>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------
const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Rate limiting (API routes only)
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (isRateLimited(ip)) {
        return addSecurityHeaders(
          Response.json({ error: "Too Many Requests" }, { status: 429, headers: { "Retry-After": "60" } })
        );
      }
    }

    const response = await requestHandler(request, { cloudflare: { env, ctx } });
    return addSecurityHeaders(response);
  },

  async scheduled(_controller, env, ctx) {
    const [{ refreshFaaAirportsIfStale }, { refreshGooglePoiSyncIfDue }] = await Promise.all([
      import("~/utils/faa-sync.server"),
      import("~/utils/google-poi-sync.server"),
    ]);

    ctx.waitUntil(
      Promise.all([
        refreshFaaAirportsIfStale({ env, ctx }),
        refreshGooglePoiSyncIfDue({ env, ctx }),
      ]).catch((error) => {
        console.error(JSON.stringify({ level: "error", message: "Scheduled sync failed", error: String(error), timestamp: new Date().toISOString() }));
      })
    );
  },
} satisfies ExportedHandler<Env>;
