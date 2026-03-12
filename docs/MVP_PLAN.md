# GA Eats MVP Plan

## Product Definition

`GA` means `General Aviation`, not `Georgia`.

GA Eats exists to help pilots find worthwhile restaurants and attractions near airports without depending on a large volume of user-generated data. Existing products in this category rely too heavily on sparse community submissions, which makes the data stale and coverage uneven.

The product should start with strong default data from external sources such as Google Maps or Yelp, then layer pilot-specific context on top:

- Default venue quality signals from third-party sources
- Pilot-specific reviews and notes as an enhancement, not a dependency
- Last-mile feasibility from airport to point of interest
- Airport ground access context such as crew cars, walkability, bikes, rideshare, and transit
- Daily staggered refreshes instead of full-database syncs to stay within provider limits

## MVP Goal

Launch a usable web product where a pilot can:

- Search or browse airports
- See nearby restaurants and attractions
- Understand whether a destination is practical after landing
- See estimated last-mile time by walking, biking, transit, or driving
- Prefer results that are actually reachable without assuming a crew car exists

## Core MVP Principles

- Do not require community density to be useful on day one.
- Prefer broad coverage over deep editorial detail at launch.
- Use pilot-generated content to improve ranking and trust, not to fill basic listings.
- Treat airport ground transportation as first-class product data.
- Separate `default public rating` from `pilot rating`.

## MVP Scope

### In

- Airport search by code, name, or city
- Airport detail pages
- Nearby restaurants and nearby attractions
- External rating and metadata import
- Last-mile travel estimates from airport to POI
- Airport access flags:
  - Walkable
  - Bikeable
  - Public transit available
  - Rideshare likely available
  - Crew car available
  - Courtesy shuttle available
- Search and filtering by:
  - Distance from airport
  - Last-mile mode
  - External rating
  - Category
- Pilot notes and reviews
- Claim listing flow for restaurant owners
- Basic ad inventory plan and placement

### Out For MVP

- Native mobile apps
- Full restaurant CRM tooling
- Rich social features
- Complex pilot profiles or gamification
- Marketplace bookings or reservations
- Real-time airport ops integrations

## User Value Proposition

### Pilots

- Find food and attractions worth the stop
- Avoid wasting time on places that are not realistically reachable
- Get a better answer than "there is a restaurant 3 miles away"

### Restaurants and attractions

- Reach a high-intent travel audience
- Claim and improve their listing
- Promote themselves near relevant airports

## Data Strategy

## 1. Foundational data

Start with durable, broad-coverage sources:

- FAA airport data for the U.S. airport backbone
- Google Maps or Yelp for restaurants and attractions
- Route and travel-time estimation from mapping APIs

Minimum fields for each POI:

- External source ID
- Name
- Category
- Address
- Lat/lng
- External rating
- External review count
- Price level if available
- URL and phone if available
- Hours if available
- Data source
- Last synced at

## 2. Aviation-specific overlay

Add GA-specific fields that external providers do not handle well:

- Crew car availability
- Courtesy shuttle availability
- Restaurant-operated shuttle availability
- Walkability assessment from airport
- Bikeability assessment from airport
- Transit viability from airport
- Rideshare viability from airport
- Airport notes for pickups, gates, FBO access, and local quirks
- Pilot reviews and pilot-only rating

## Airport Source Decision

For MVP, airport backbone data should come from the FAA for U.S. coverage.

Use FAA data for:

- airport identifiers
- airport names
- city/state
- coordinates
- core airport reference data

Do not rely on FAA data for:

- FBO-specific operational details
- crew car availability
- courtesy shuttle availability
- rideshare practicality
- pickup and access workflow notes

Those fast-changing operational details should remain in the access-facts layer and be refreshed separately.

## 3. Ranking strategy

Initial ranking should blend:

- Reachability from airport
- Last-mile time
- External rating
- External review count
- Category relevance
- Pilot rating if present
- Pilot review count if present

This avoids the cold-start problem while still rewarding pilot contributions.

## Recommended MVP Data Model

### Airport

- FAA/IATA/ICAO identifiers
- Name
- City/state/country
- Lat/lng
- FBO notes
- Crew car status
- Crew car confidence
- Courtesy shuttle status
- Courtesy shuttle confidence
- Rideshare status
- Rideshare confidence
- Transit status
- Transit confidence
- Walkability status
- Walkability confidence
- Bikeability status
- Bikeability confidence
- Source attribution for each access field
- Last verified at

### POI

- External source and source ID
- Name
- Type: restaurant or attraction
- Category/subcategory
- Address
- Lat/lng
- External rating
- External review count
- Pilot rating aggregate
- Pilot review count
- Price level
- URL
- Phone
- Hours snapshot
- Restaurant shuttle status
- Restaurant shuttle notes
- Restaurant shuttle phone
- Restaurant shuttle confidence
- Restaurant shuttle source
- Active status
- Last synced at

### AirportPOIRelationship

- Airport ID
- POI ID
- Distance meters
- Walking minutes
- Biking minutes
- Transit minutes
- Driving minutes
- Reachability mode summary
- Preferred mode
- Needs crew car boolean
- Needs rideshare boolean
- Access confidence summary
- Last calculated at

## Access Metadata Policy

Airport and last-mile access data should not be modeled as simple booleans. It becomes stale too quickly, especially for smaller FBOs and municipal airports.

Use this structure for each access mode:

- `status`: `yes | no | limited | unknown`
- `confidence`: `high | medium | low`
- `source_type`: `airport | fbo | restaurant | pilot_review | claimed_listing | inferred | manual`
- `source_detail`: free-text note or URL
- `last_verified_at`
- `verification_method`

This should apply to:

- Crew car
- Courtesy shuttle
- Restaurant shuttle
- Rideshare
- Transit
- Walkability
- Bikeability

## Rideshare Strategy

Rideshare is not a stable yes/no fact. For MVP, treat it as an inferred access mode unless explicitly confirmed.

High-confidence rideshare:

- Airport or FBO explicitly confirms Uber, Lyft, or taxi access
- Multiple recent pilot reviews confirm successful pickup

Medium-confidence rideshare:

- Airport is near a populated area
- Recent public or pilot evidence suggests pickups happen there

Low-confidence rideshare:

- General regional plausibility without direct airport evidence

Default:

- `unknown`

Do not confidently mark `no` unless there is explicit evidence.

## Restaurant Shuttle Strategy

Restaurant-operated transportation is valuable and should be surfaced as its own signal, not folded into generic shuttle access.

Candidate sources:

- Restaurant website
- Google business profile text
- Claimed listing owner updates
- Pilot reviews
- Direct outreach

UI badges should keep this separate:

- Walkable
- Bikeable
- Transit
- Rideshare likely
- Crew car
- Courtesy shuttle
- Restaurant shuttle

## Stale Data Strategy

Airport and FBO transportation data will decay. Assume it is perishable.

The product should be designed around confidence and freshness, not around pretending the data is permanently correct.

### Rules

- Every operational field needs `last_verified_at`.
- Every operational field needs a source.
- Older records should lose ranking weight over time.
- Unknown is better than wrong.
- User-facing copy should distinguish confirmed facts from likely conditions.

### Freshness windows

Suggested defaults:

- `0-90 days`: fresh
- `91-180 days`: aging
- `181-365 days`: stale
- `365+ days`: untrusted unless reconfirmed

### What to do with stale records

- Keep the record, but downgrade confidence
- Reduce its impact on ranking
- Show a stale badge or low-confidence note
- Queue it for reverification
- Prompt pilots for lightweight confirmations

### Verification ladder

Preferred evidence, strongest to weakest:

1. Claimed or direct operator confirmation
2. Airport or FBO published info
3. Recent pilot confirmation
4. Recent restaurant confirmation
5. Internal inference from geography and routing data

### Product behavior

When data is weak:

- Show `unknown` instead of fabricating certainty
- Prefer walkable and route-confirmed options in ranking
- Avoid hard promises like `crew car available`
- Use softer language like `rideshare likely` or `not recently verified`

### Operational strategy

To manage staleness at MVP scale:

- Start with a narrow airport set
- Track reverification queues
- Ask for one-tap pilot confirmations:
  - crew car worked
  - no rideshare found
  - shuttle available
  - easy walk
- Let claimed businesses and airport operators update transport details
- Recheck low-confidence airports on a schedule

This creates a system where stale data degrades gracefully instead of silently becoming misleading.

### PilotReview

- Airport ID
- POI ID
- Rating
- Review text
- Tags:
  - good crew-car stop
  - easy walk
  - worth the detour
  - expensive
  - quick lunch
  - date spot
- Submitted at
- Moderation status

### ClaimedListing

- POI ID
- Business owner identity
- Verification state
- Editable fields
- Ad package status

## MVP Feature Phases

## Phase 0: Foundation

- [x] Rename and rewrite product copy so it consistently means General Aviation
- [ ] Replace placeholder README with real product and developer setup
- [x] Stabilize app build, typecheck, routing, and deployment
- [x] Fix API route registration and ensure airport/POI endpoints are reachable
- [ ] Establish environment strategy for Google Maps and external data providers

Exit criteria:

- App builds and deploys cleanly
- Core routes and APIs are reachable
- Product messaging matches actual target market

## Phase 1: Data Backbone

- [x] Finalize schema for airports, POIs, airport-to-POI travel metrics, and pilot reviews
- [x] Choose source strategy:
  - FAA for airport backbone
  - Google Maps primary for POIs
  - Yelp optional later fallback
- [x] Build import/sync pipeline for restaurants and attractions near airports
- [ ] Add deduplication logic for POIs across sync runs
- [ ] Track sync provenance and freshness timestamps
- [x] Design sync cadence around daily limited-batch refreshes
- [x] Move FAA and POI refresh ownership into production cron jobs
- [ ] Add adaptive sync prioritization based on traffic, stale access data, and POI density
- [x] Add FAA airport refresh job aligned to the FAA publication cycle
- [ ] Seed initial airport coverage for the launch geography

Exit criteria:

- Airports and POIs exist in the database with stable IDs
- Data can be refreshed without manual cleanup

## Phase 2: Reachability Layer

- [ ] Compute airport-to-POI distance and travel times
- [ ] Store walking, biking, transit, and driving estimates where available
- [x] Introduce airport access fields for crew cars, shuttle, rideshare, transit, walkability, and bikeability
- [x] Introduce freshness and confidence scoring for all access metadata
- [ ] Define logic for "reachable without car"
- [ ] Rank walkable, bikeable, and transit-friendly results above car-dependent ones by default

Exit criteria:

- A pilot can tell whether a listing is realistically usable after landing
- Search results reflect last-mile practicality, not just straight-line distance

## Phase 3: MVP UX

- [x] Airport page with nearby restaurants and attractions
- [x] Search by airport code, airport name, city, or map
- [ ] Filters for category, mode, time, and rating
- [ ] Clear badges for:
  - Walkable
  - Bikeable
  - Transit
  - Crew car
  - Shuttle
  - Rideshare
- [x] Last-mile summary on each result card
- [ ] Map route synced to selected travel mode
- [x] Empty-state and low-confidence messaging when data is uncertain

Exit criteria:

- A new user can land on the site and plan a viable lunch stop quickly

## Phase 4: Pilot Overlay

- [ ] Add pilot review submission
- [ ] Add lightweight airport access confirmations
- [ ] Add pilot-only rating aggregate
- [ ] Add moderation and abuse controls
- [ ] Add airport notes for pickup logistics and practical tips
- [ ] Show external rating and pilot rating as separate signals

Exit criteria:

- Pilot content improves the product without being required for baseline usefulness

## Phase 5: Monetization Basics

- [ ] Define ad placements that do not degrade the core search experience
- [ ] Add claimed listing workflow
- [ ] Allow listing owners to verify and update business details
- [ ] Define sponsored placement rules and disclosure language
- [ ] Track conversion metrics for advertiser value

Exit criteria:

- Monetization exists without undermining ranking trust

## Recommended Launch Strategy

Do not try to launch nationally at full fidelity on day one.

**Initial Population Strategy:**
The MVP does not require a pre-seeded database of POIs. Instead, the production environment will use the daily staggered sync process to slowly populate the database.

**Launch Geography:**
The initial launch will focus on the **West Coast**, with a specific one-time priority given to the **San Francisco Bay Area (NorCal)**. The first production sync cycles will target airports in this region to ensure a high-quality initial experience for West Coast pilots, before naturally expanding across the U.S.

Good initial launch slices:
- San Francisco Bay Area (Priority 1)
- Pacific Northwest (Priority 2)
- Southern California (Priority 3)

## Open Product Decisions

- [x] Choose primary source: Google Maps
- [x] Choose launch geography: West Coast (Bay Area start)
- [ ] Define what counts as an attraction for MVP
- [ ] Decide whether attractions ship in MVP or one release after restaurants
- [ ] Decide whether claimed listings can edit only business metadata or also promos
- [ ] Decide whether ads are CPC, flat-rate sponsorship, or featured placement subscription

## Recommended Technical Sequence

1. Fix product copy and route structure.
2. Finalize schema for airports, POIs, and airport-to-POI metrics.
3. Build the sync/import job with regional prioritization (starting with NorCal).
4. Compute and persist last-mile travel metrics using real routing data (Distance Matrix).
5. Build airport-first browsing UX.
6. Add pilot reviews.
7. Add claimed listings and ads.

This sequence minimizes wasted UI work before the data model is stable.

## Launch Checklist

- [x] Real product copy replaces placeholder messaging
- [x] Search works for airport code and airport name
- [x] Airport detail page shows useful nearby restaurants
- [x] Attractions are included or explicitly deferred
- [x] Last-mile time is visible on every listing
- [x] Reachability badges are visible on every listing
- [x] Access badges include freshness or confidence handling
- [ ] External source and freshness are stored
- [ ] Pilot reviews can be submitted
- [ ] External and pilot ratings are distinct
- [ ] Basic analytics are installed
- [ ] Claimed listing workflow exists or is intentionally deferred
- [ ] Ad policy and disclosure rules are documented
- [ ] Seed geography has strong enough data coverage
- [ ] Deployment and sync jobs run reliably

## Success Metrics For MVP

- Percentage of airport searches that return at least 3 viable results
- Percentage of results reachable without a crew car
- Time from airport page load to first useful decision
- Pilot review submission rate
- Claimed listing conversion rate
- Ad clickthrough and sponsor retention

## Immediate Next Actions

- [x] Rewrite homepage and docs around General Aviation, not Georgia
- [x] Decide primary POI source for MVP
- [x] Decide primary airport source for MVP
- [x] Extend schema for attractions, airport access metadata, and pilot reviews
- [x] Build a first-pass import pipeline for airports plus POIs
- [ ] Build airport-to-POI travel time calculation and ranking
- [x] Redesign the UI around airport-first discovery instead of a generic map demo
