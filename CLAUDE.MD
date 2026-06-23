Always use context7 when I need code generation, setup or
configuration steps, or library/API documentation. This means
you should automatically use the Context7 MCP tools to resolve
library id and get library docs without me having to
explicitly ask.

##CODING Practices
Ensure each feature delivered has testing to accompany it to ensure that future updates do not impact current functionality.
Ensure all code is commented per best practices.
Update CLAUDE.MD as needed.

##Technology Stack
- **Frontend**: React Router v7 (framework mode)
- **Runtime**: Cloudflare Workers (edge deployment)
- **Database**: Prisma Postgres with PostGIS extension
- **ORM**: Prisma v7 with Accelerate for edge caching
- **Maps**: Google Maps JavaScript API via @vis.gl/react-google-maps
- **Testing**: Vitest with unit tests
- **Styling**: Tailwind CSS v4

##Transient Parking Sync (Gemini Batch)
- Pipeline: `sync-transient-info-submit.js` queues a Gemini batch (one grounded
  request per airport) and saves a PENDING `transientSyncJob`;
  `sync-transient-info-collect.js` reads the finished batch, writes notes to
  `airports`, and marks the job DONE. Submit skips while a PENDING job exists,
  so collect MUST run for the pipeline to keep moving.
- Webhook-driven collect: Gemini fires a Standard Webhooks-signed POST to
  `app/routes/api.webhooks.gemini-batch.ts` on `batch.succeeded`/`batch.failed`,
  which dispatches the collect workflow (its only trigger — there is no cron, so
  a missed webhook is re-run manually via `workflow_dispatch`). Register the
  webhook once: `node scripts/register-gemini-webhook.js --uri=<deployed-url>/api/webhooks/gemini-batch`,
  then store the returned signing secret as the Worker's `WEBHOOK_SIGNING_SECRET`
  (`wrangler secret put WEBHOOK_SIGNING_SECRET`). The handler verifies the
  `webhook-id`/`webhook-timestamp`/`webhook-signature` headers over the raw body
  (`app/utils/standardWebhooks.server.ts`, guarded by `standardWebhooks.test.ts`).
  The "thin" payload is `{ type, data: { id } }`.
- `.text` getter trap: `GenerateContentResponse.text` is a *getter* that only
  exists on live SDK instances. Batch results from `batches.get()` are plain
  JSON (`dest.inlinedResponses[i].response`), so `.text` is `undefined` there —
  reading it made collect report "no transient info found" for every airport.
  Use `extractResponseText()` from `scripts/lib/gemini-utils.js`, which walks
  `candidates[0].content.parts[].text` (guarded by `gemini-utils.test.js`).
- Ramp/FBO coordinate resolution: `rampLatitude`/`rampLongitude` are resolved by
  `resolveRampCoordinates()` (`scripts/lib/ramp-coordinates.js`), NOT by asking
  GPT-4o to guess from the airport reference point (ARP). Given only the ARP +
  prose, GPT-4o just echoed the ARP back (the geometric runway center, never
  where pilots park). The resolver prefers real data in tiers: (1) snap to a
  named FBO's verified coordinate from `airport_fbos`; (2) generic "FBO"
  reference → nearest known FBO; (3) Google Places geocode of the description
  (needs `GOOGLE_MAPS_SERVER_API_KEY`); (4) GPT-4o *anchored* with the real FBO
  coordinates; (5) nearest known FBO as a last resort. Any Places/GPT-4o result
  within ~60 m of the ARP is rejected as an ARP-echo, and anything implausibly
  far from the field is discarded. The Gemini prompt also now returns an
  `fboName` field to strengthen tier 1. Guarded by `ramp-coordinates.test.js`.

##Google Maps Integration
- Uses @vis.gl/react-google-maps (v1.7.1) for React integration
- Supports satellite view, hybrid view, and street view
- Multi-modal directions: walking, biking, transit, driving
- Turn-by-turn navigation with step-by-step instructions
- API Key configured via VITE_GOOGLE_MAPS_API_KEY environment variable
- Map ID note: Advanced Markers (the pins) require a *valid* cloud Map ID,
  configured via VITE_GOOGLE_MAPS_MAP_ID. An invalid/placeholder ID makes pins
  mis-project (wrong location, wrong effective zoom). Falls back to Google's
  `DEMO_MAP_ID` when unset. Guarded by the GoogleMapComponent test.
- CSS conflict note: Tailwind's Preflight reset (`img { max-width: 100% }` and
  global `box-sizing: border-box`) distorts map tiles and mis-projects markers
  (wrong location, clustered, not panning with the map). The `<Map>` element
  carries a `google-maps-container` class whose scoped reset in `app/app.css`
  restores the box model Google Maps expects. Do not remove either half; the
  contract is guarded by `app/components/__tests__/GoogleMapComponent.test.ts`. 