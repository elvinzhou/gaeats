import { createRequestHandler } from "react-router";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
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
        console.error("Scheduled sync failed:", error);
      })
    );
  },
} satisfies ExportedHandler<Env>;
