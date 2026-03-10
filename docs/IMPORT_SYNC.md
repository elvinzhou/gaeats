# Import And Sync

## Purpose

This project now includes a first-pass sync pipeline for:

- importing airports from the FAA NASR airport dataset
- syncing restaurant POIs from Google Places
- syncing attraction POIs from Google Places

The intended operating model is a staggered daily refresh, not a full refresh on every run.
Each run should process only a small batch of due airports so usage stays under free-tier limits.

For MVP, airport data should ultimately be sourced from the FAA for U.S. coverage, with a slower refresh cadence than POIs.
In production, sync should be owned by the Worker's scheduled cron handler rather than by manual scripts.

## Environment

Required variables are listed in [.env.example](/workspaces/gaeats/.env.example):

- `DATABASE_URL`
- `DIRECT_URL`
- `VITE_GOOGLE_MAPS_API_KEY`
- `GOOGLE_MAPS_SERVER_API_KEY`

For write-heavy sync jobs, prefer `DIRECT_URL` so the scripts talk directly to Postgres.

## Commands

Run FAA import manually for debugging or backfill:

```bash
npm run import:faa-airports
```

Run restaurant POI sync manually for debugging or backfill:

```bash
npm run sync:google-pois -- --type=RESTAURANT --limit=5
```

Run attraction POI sync manually for debugging or backfill:

```bash
npm run sync:google-pois -- --type=ATTRACTION --limit=5
```

Run the full MVP sync manually:

```bash
npm run sync:mvp
```

## Script Notes

The FAA airport import now discovers the current NASR archive from the FAA discovery API and parses `APT.TXT` from the ZIP.
The download discovery and APT parsing approach is adapted from `aeroinfo`:

- <https://github.com/kdknigga/aeroinfo/blob/master/aeroinfo/download_nasr.py>
- <https://github.com/kdknigga/aeroinfo/blob/master/aeroinfo/parsers/apt.py>

You can still override the source with `--file`, `--url`, or `--dataset` when needed.

The Google sync script:

- fetches places near a limited batch of due airports
- upserts canonical `pois`
- creates or updates `airport_pois` link rows
- stores straight-line distance immediately
- updates airport sync bookkeeping fields after each successful refresh
- leaves richer route timing for the dedicated reachability pass

Production note:

- [workers/app.ts](/workspaces/gaeats/workers/app.ts) now owns scheduled FAA and Google sync execution
- [wrangler.jsonc](/workspaces/gaeats/wrangler.jsonc) configures a daily cron trigger at `03:00 UTC`
- the scripts remain as wrappers for local debugging or one-off backfills, not as the primary runtime path

Implementation note:

- sync commands use Node's `--experimental-transform-types` flag so the generated
  Prisma TypeScript client can run locally without adding another runtime

## Current Limitations

- Google Places is the only implemented POI source
- route travel times are not computed by the sync yet
- access facts still need dedicated source ingestion
- sync cadence currently uses a simple round-robin heuristic, not adaptive prioritization

## Refresh Strategy

- assign each airport a `nextPoiSyncAt`
- run the scheduled sync job on cron
- process only a limited number of due airports per run
- move those airports to a future `nextPoiSyncAt`
- keep rotating until the launch cohort is fully refreshed, then start again

This is intentionally conservative because restaurant and attraction data usually changes slowly enough that a full daily refresh would waste quota.

## FAA Refresh Strategy

Airport backbone data should refresh on the FAA publication cycle rather than on the POI cadence.

Recommended approach:

- import FAA airport data into the canonical airport table
- run a dedicated FAA refresh roughly once per FAA 28-day data cycle
- treat FAA as the source of truth for airport identifiers and coordinates
- keep airport access facts in a separate, faster-changing layer

This keeps stable airport reference data and volatile operational data from being mixed together.

## Suggested Next Steps

- replace sample airport seed data with the first launch cohort
- add deduplication heuristics beyond provider IDs
- add Google Routes sync for walking, biking, transit, and driving minutes
- ingest airport access facts from operator/FBO sources
