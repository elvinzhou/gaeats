// Resolve transient-parking ramp/FBO coordinates from Gemini's plain-language
// description, grounded in real geospatial data.
//
// WHY THIS EXISTS
// ---------------
// The first cut asked GPT-4o to estimate a coordinate from nothing but the FAA
// airport reference point (ARP) and a sentence of text. With no knowledge of the
// actual airport layout, the model almost always echoed the ARP back (or nudged
// it a few hundred metres toward a cardinal direction it guessed at). The ARP is
// the geometric centre of the runway system — it is essentially never where a
// visiting pilot parks.
//
// This resolver fixes that by preferring REAL data over the model's guesswork,
// in priority order:
//   1. FBO_MATCH    — the description names an FBO we already have verified
//                     coordinates for (airport_fbos, sourced from OSM/Google).
//   2. FBO_FALLBACK — the description references "the FBO" generically and the
//                     field has a known FBO; snap to it.
//   3. GOOGLE_PLACES— geocode the described place against Google Places, biased
//                     to the field (optional; needs GOOGLE_MAPS_SERVER_API_KEY).
//   4. GPT4O        — last-resort estimate, but now ANCHORED with the real FBO
//                     coordinates and hard-instructed not to return the ARP.
//   5. FBO_NEAREST  — nothing pinned the ramp, but the field has an FBO; an
//                     on-field FBO is still far better than the ARP.
//
// Every model/Places result is sanity-checked: anything within ~60 m of the ARP
// is treated as "the model just returned the airport again" and rejected, and
// anything implausibly far from the field is discarded.

import { parseJson } from "./gemini-utils.js";

// Words that carry no identifying signal in an FBO name. Stripping these leaves
// the distinctive brand token(s) we actually match on ("Signature Flight
// Support" -> "signature", "Atlantic Aviation" -> "atlantic").
const FBO_STOPWORDS = new Set([
  "aviation", "flight", "support", "services", "service", "air", "center",
  "centre", "fbo", "inc", "llc", "co", "ltd", "the", "jet", "jets", "aero",
  "airport", "field", "international", "intl", "general", "terminal", "group",
  "holdings", "management", "company", "and", "of", "at", "llp",
]);

/**
 * Great-circle distance between two {latitude, longitude} points, in metres.
 */
export function haversineMeters(a, b) {
  const R = 6371000; // Earth radius, metres
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Distinctive, lowercased tokens of an FBO name (generic aviation words and
 * short noise removed). Returns [] when the name has no identifying token
 * (e.g. a record literally named "FBO" or "General Aviation").
 */
export function significantTokens(name) {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !FBO_STOPWORDS.has(t));
}

/**
 * Rank one FBO match against the current best. Prefer a complete name match,
 * then more tokens matched, then the longer (more specific) match — this guards
 * against a short generic token winning over a fuller brand match.
 */
function isBetterMatch(candidate, best) {
  if (!best) return true;
  if (candidate.allMatched !== best.allMatched) return candidate.allMatched;
  if (candidate.score !== best.score) return candidate.score > best.score;
  return candidate.matchedLen > best.matchedLen;
}

/**
 * Find the known FBO that the free-text description names, if any.
 *
 * @param {{text: string, fbos: Array<{name: string, latitude: number, longitude: number}>}} args
 * @returns {{fbo: object, score: number, allMatched: boolean}|null} best match, or null
 */
export function matchFboInText({ text, fbos }) {
  const haystack = (text ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  if (!haystack.trim()) return null;

  let best = null;
  for (const fbo of fbos ?? []) {
    const tokens = significantTokens(fbo.name);
    if (tokens.length === 0) continue;

    const matched = tokens.filter((t) => new RegExp(`\\b${t}\\b`).test(haystack));
    if (matched.length === 0) continue;

    const candidate = {
      fbo,
      score: matched.length,
      matchedLen: matched.join("").length,
      allMatched: matched.length === tokens.length,
    };

    if (isBetterMatch(candidate, best)) best = candidate;
  }
  return best;
}

/** True when the text references an FBO at all (named brand or the word "FBO"). */
export function mentionsFbo(text) {
  return /\bfbo\b|fixed[-\s]?base|flight\s+support/i.test(text ?? "");
}

/** True when the text describes a ramp/apron/tie-down area. */
export function mentionsTransientRamp(text) {
  return /\b(ramps?|aprons?|tie[-\s]?downs?|tiedowns?)\b/i.test(text ?? "");
}

/** Whether a coordinate is within `thresholdMeters` of the ARP (i.e. "no better than the airport"). */
export function isEssentiallyArp(coord, arp, thresholdMeters = 60) {
  if (!coord || !arp) return false;
  return haversineMeters(coord, arp) <= thresholdMeters;
}

/** Whether a coordinate is finite, in-range, and within `maxKm` of the field. */
export function isPlausibleRamp(coord, arp, maxKm = 8) {
  if (!coord) return false;
  const { latitude, longitude } = coord;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return false;
  if (arp && haversineMeters(coord, arp) > maxKm * 1000) return false;
  return true;
}

/**
 * Pick which known FBO to use for a generic reference: the only one if there's a
 * single record, otherwise the one closest to the ARP.
 */
export function chooseFboFallback(fbos, arp) {
  const valid = (fbos ?? []).filter(
    (f) => Number.isFinite(f.latitude) && Number.isFinite(f.longitude)
  );
  if (valid.length === 0) return null;
  if (valid.length === 1 || !arp) return valid[0];
  return valid.reduce((closest, f) =>
    haversineMeters(f, arp) < haversineMeters(closest, arp) ? f : closest
  );
}

// ---------------------------------------------------------------------------
// Ramp / apron location (OSM `aeroway=apron`)
// ---------------------------------------------------------------------------
//
// When Gemini says transient parking is "on the ramp", the ramp is a real
// apron polygon that OpenStreetMap usually maps as `aeroway=apron`. We pull
// those aprons and pick the one the description points at — by named side
// (cardinal), by proximity to the named FBO, or by an explicit transient/GA
// name tag. This is preferred over snapping to an FBO: airports frequently have
// both, and the transient ramp is the correct answer.

const TRANSIENT_APRON_RE = /transient|visitor|itinerant|general\s+aviation|\bga\b|tie[-\s]?downs?/i;

/** Initial compass bearing from `from` to `to`, in degrees (0=N, 90=E). */
export function bearingDegrees(from, to) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLon = toRad(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(toRad(to.latitude));
  const x =
    Math.cos(toRad(from.latitude)) * Math.sin(toRad(to.latitude)) -
    Math.sin(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest absolute difference between two bearings, in degrees (0-180). */
export function angularDifference(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * The compass bearing implied by a cardinal direction word in the text, or null.
 * Compound directions ("northeast") are checked before the singles they contain.
 */
export function parseCardinalBearing(text) {
  const t = (text ?? "").toLowerCase();
  const table = [
    [/north[-\s]?east|northeast/, 45],
    [/north[-\s]?west|northwest/, 315],
    [/south[-\s]?east|southeast/, 135],
    [/south[-\s]?west|southwest/, 225],
    [/\bnorth(ern)?\b/, 0],
    [/\bsouth(ern)?\b/, 180],
    [/\beast(ern)?\b/, 90],
    [/\bwest(ern)?\b/, 270],
  ];
  for (const [re, deg] of table) if (re.test(t)) return deg;
  return null;
}

function nearestByHaversine(list, point) {
  return list.reduce((best, a) =>
    haversineMeters(a, point) < haversineMeters(best, point) ? a : best
  );
}

/**
 * Pick the apron the description refers to.
 *
 * Priority: (1) named cardinal side relative to the ARP; (2) the apron in front
 * of the named FBO; (3) an apron tagged transient/visitor/GA; (4) the apron by
 * the field's FBO; (5) the apron nearest the ARP.
 *
 * @param {{aprons: Array, text: string, arp: object, matchedFbo?: object|null, fbos?: Array}} args
 * @returns {object|null} the chosen apron, or null
 */
export function chooseApron({ aprons, text, arp, matchedFbo = null, fbos = [] }) {
  const valid = (aprons ?? []).filter(
    (a) => Number.isFinite(a.latitude) && Number.isFinite(a.longitude)
  );
  if (valid.length === 0) return null;

  // 1. "south ramp" / "northeast tie-downs" → apron most in that direction.
  const target = parseCardinalBearing(text);
  if (target != null && arp) {
    return valid.reduce(
      (best, a) => {
        const diff = angularDifference(bearingDegrees(arp, a), target);
        return diff < best.diff ? { apron: a, diff } : best;
      },
      { apron: null, diff: Infinity }
    ).apron;
  }

  // 2. A named FBO matched → the apron directly in front of it.
  if (matchedFbo && Number.isFinite(matchedFbo.latitude)) {
    return nearestByHaversine(valid, matchedFbo);
  }

  // 3. An apron explicitly tagged for transient/visitor/GA use.
  const named = valid.find((a) => TRANSIENT_APRON_RE.test(a.name ?? ""));
  if (named) return named;

  // 4. The field has FBOs → the apron next to the FBO nearest the ARP.
  const anchorFbo = chooseFboFallback(fbos, arp);
  if (anchorFbo) return nearestByHaversine(valid, anchorFbo);

  // 5. Fallback: the apron nearest the airport reference point.
  return arp ? nearestByHaversine(valid, arp) : valid[0];
}

/**
 * Fetch `aeroway=apron` polygons near the airport from OSM Overpass.
 * Returns `[{ name, latitude, longitude, tags }]` (centroids). Throws on a
 * non-OK response so the caller can fall through to other tiers.
 */
export async function fetchOsmAprons({ arp, fetchImpl = fetch, radius = 3000, attempt = 1 }) {
  const query = `[out:json][timeout:25];(way["aeroway"="apron"](around:${radius},${arp.latitude},${arp.longitude});relation["aeroway"="apron"](around:${radius},${arp.latitude},${arp.longitude}););out center tags;`;

  const response = await fetchImpl("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });

  // Overpass is shared infrastructure — back off briefly on rate/timeout.
  if ((response.status === 429 || response.status === 504) && attempt < 3) {
    await new Promise((r) => setTimeout(r, attempt * 3000));
    return fetchOsmAprons({ arp, fetchImpl, radius, attempt: attempt + 1 });
  }

  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);

  const data = await response.json();
  return (data.elements ?? [])
    .map((el) => {
      const latitude = el.center?.lat ?? el.lat;
      const longitude = el.center?.lon ?? el.lon;
      if (latitude == null || longitude == null) return null;
      return { name: el.tags?.name ?? null, latitude, longitude, tags: el.tags ?? {} };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Network tiers (injectable fetch for testing)
// ---------------------------------------------------------------------------

/**
 * Geocode a described place via Google Places Text Search, biased to the field.
 * Returns the first result's coordinate, or null.
 */
export async function geocodeViaGooglePlaces({ query, arp, apiKey, fetchImpl }) {
  const response = await fetchImpl("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.location",
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: {
        circle: {
          center: { latitude: arp.latitude, longitude: arp.longitude },
          radius: 3000,
        },
      },
      maxResultCount: 3,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Places HTTP ${response.status}`);
  }

  const data = await response.json();
  const place = (data.places ?? [])[0];
  if (!place?.location) return null;
  return {
    latitude: place.location.latitude,
    longitude: place.location.longitude,
    name: place.displayName?.text ?? null,
  };
}

/**
 * Estimate the ramp coordinate with GPT-4o — anchored on the airport's real FBO
 * coordinates and explicitly forbidden from returning the ARP. Returns
 * {latitude, longitude, reasoning} or null when the model declines.
 */
export async function synthesizeViaGpt4o({ airport, locationDescription, fbos, aprons = [], apiKey, fetchImpl }) {
  const coordLine = (x, label) =>
    `  - ${x.name || label}: ${Number(x.latitude).toFixed(6)}, ${Number(x.longitude).toFixed(6)}`;

  const fboLines = (fbos ?? [])
    .filter((f) => Number.isFinite(f.latitude) && Number.isFinite(f.longitude))
    .map((f) => coordLine(f, "FBO"))
    .join("\n");

  const apronLines = (aprons ?? [])
    .filter((a) => Number.isFinite(a.latitude) && Number.isFinite(a.longitude))
    .map((a) => coordLine(a, "apron"))
    .join("\n");

  const blocks = [];
  if (fboLines) blocks.push(`Known on-field FBOs/operators with verified coordinates:\n${fboLines}`);
  if (apronLines) blocks.push(`Known apron/ramp centroids on the field (from OpenStreetMap):\n${apronLines}`);
  const anchorBlock = blocks.length
    ? `${blocks.join("\n")}\nUse these as anchors.`
    : "No verified FBO or apron coordinates are available for this airport.";

  const system = `You estimate the GPS coordinate of transient (visiting) aircraft parking at a general-aviation airport.
Rules:
- The airport reference point (ARP) is the geometric center of the runways. Transient parking is almost NEVER at the ARP. Do NOT return the ARP or a point within ~100m of it.
- If the description names one of the listed FBOs/operators, return that FBO's coordinate — the transient ramp is the apron adjacent to it.
- If it names a ramp by side (e.g. "south ramp", "east tie-downs"), offset roughly 150-700m from the ARP toward that side, staying on airport property.
- If you cannot place the parking any more precisely than the airport center, return nulls.
Return raw JSON only: {"latitude": number|null, "longitude": number|null, "reasoning": "..."}`;

  const user = `Airport: ${airport.code} — ${airport.name}
ARP: ${Number(airport.latitude).toFixed(6)}, ${Number(airport.longitude).toFixed(6)}
${anchorBlock}
Transient parking description: "${locationDescription}"

Estimate the GPS coordinate of the transient parking.`;

  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
      max_tokens: 250,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const parsed = parseJson(data.choices?.[0]?.message?.content ?? "");
  if (parsed?.latitude != null && parsed?.longitude != null) {
    return {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      reasoning: parsed.reasoning ?? null,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/** Google Places geocode tier — returns a result or null (never throws). */
async function googlePlacesTier({ airport, arp, extraction, env, fetchImpl }) {
  if (!env.GOOGLE_MAPS_SERVER_API_KEY || !extraction?.locationDescription) return null;
  try {
    const query = `${extraction.locationDescription} ${airport.code} ${airport.name}`.trim();
    const g = await geocodeViaGooglePlaces({ query, arp, apiKey: env.GOOGLE_MAPS_SERVER_API_KEY, fetchImpl });
    if (g && isPlausibleRamp(g, arp) && !isEssentiallyArp(g, arp)) {
      return {
        latitude: g.latitude,
        longitude: g.longitude,
        source: "GOOGLE_PLACES",
        reasoning: `Google Places match${g.name ? ` "${g.name}"` : ""}`,
      };
    }
  } catch {
    // ignore — caller falls through to the next tier
  }
  return null;
}

/** Anchored GPT-4o tier — returns a result or null (never throws). ARP-echoes rejected. */
async function gpt4oTier({ airport, arp, extraction, fbos, aprons, env, fetchImpl }) {
  if (!env.OPENAI_API_KEY || !extraction?.locationDescription) return null;
  try {
    const c = await synthesizeViaGpt4o({
      airport,
      locationDescription: extraction.locationDescription,
      fbos,
      aprons,
      apiKey: env.OPENAI_API_KEY,
      fetchImpl,
    });
    if (c && isPlausibleRamp(c, arp) && !isEssentiallyArp(c, arp)) {
      return {
        latitude: c.latitude,
        longitude: c.longitude,
        source: "GPT4O",
        reasoning: c.reasoning ?? "GPT-4o anchored estimate",
      };
    }
  } catch {
    // ignore — caller falls through to the next tier
  }
  return null;
}

/** Known-FBO fallback — an on-field FBO always beats the ARP. */
function fboFallbackTier({ fbos, arp, source = "FBO_NEAREST", reasonPrefix = "Nearest known FBO" }) {
  const fb = chooseFboFallback(fbos, arp);
  if (!fb) return null;
  return { latitude: fb.latitude, longitude: fb.longitude, source, reasoning: `${reasonPrefix} "${fb.name}"` };
}

/**
 * Resolve the best available ramp/FBO coordinate for an airport.
 *
 * When the description points at a transient ramp/apron, the ramp is located
 * first (real OSM apron geometry, then Places/GPT-4o), and only falls back to
 * the FBO if the ramp can't be pinned — so airports that have BOTH an FBO and a
 * distinct transient ramp resolve to the ramp. When the description is purely
 * about the FBO, it snaps to the FBO.
 *
 * @param {object} args
 * @param {{code: string, name: string, latitude: number, longitude: number}} args.airport
 * @param {{notes?: string, locationDescription?: string, fboName?: string}} args.extraction  Gemini output
 * @param {Array<{name: string, latitude: number, longitude: number}>} [args.fbos]  Known FBOs (airport_fbos)
 * @param {{OPENAI_API_KEY?: string, GOOGLE_MAPS_SERVER_API_KEY?: string}} [args.env]
 * @param {typeof fetch} [args.fetchImpl]
 * @returns {Promise<{latitude: number, longitude: number, source: string, reasoning: string}|null>}
 */
export async function resolveRampCoordinates({
  airport,
  extraction,
  fbos = [],
  env = {},
  fetchImpl = fetch,
}) {
  const arp = { latitude: Number(airport.latitude), longitude: Number(airport.longitude) };
  // fboName (when Gemini supplies it) and locationDescription carry the strongest
  // location signal; notes is included so a brand mentioned only in prose still matches.
  const text = [extraction?.fboName, extraction?.locationDescription, extraction?.notes]
    .filter(Boolean)
    .join(" ");

  const fboMatch = matchFboInText({ text, fbos });
  const fboMatchResult = fboMatch
    ? {
        latitude: fboMatch.fbo.latitude,
        longitude: fboMatch.fbo.longitude,
        source: "FBO_MATCH",
        reasoning: `Matched named FBO "${fboMatch.fbo.name}"`,
      }
    : null;

  // RAMP-FIRST — the description points at a transient ramp/apron. Locate the
  // ramp itself before considering the FBO (an airport may have both, and the
  // transient ramp is the correct answer).
  if (mentionsTransientRamp(text)) {
    let aprons = [];
    try {
      aprons = await fetchOsmAprons({ arp, fetchImpl });
    } catch {
      aprons = [];
    }

    const apron = chooseApron({ aprons, text, arp, matchedFbo: fboMatch?.fbo ?? null, fbos });
    if (apron && isPlausibleRamp(apron, arp)) {
      return {
        latitude: apron.latitude,
        longitude: apron.longitude,
        source: "OSM_APRON",
        reasoning: apron.name ? `OSM apron "${apron.name}"` : "OSM apron matching description",
      };
    }

    return (
      (await googlePlacesTier({ airport, arp, extraction, env, fetchImpl })) ??
      (await gpt4oTier({ airport, arp, extraction, fbos, aprons, env, fetchImpl })) ??
      // The FBO is a reasonable proxy for "the ramp by the FBO" once the apron
      // itself can't be pinned.
      fboMatchResult ??
      fboFallbackTier({ fbos, arp })
    );
  }

  // FBO-FIRST — parking is described at the FBO, with no distinct ramp.
  if (fboMatchResult) return fboMatchResult;
  if (mentionsFbo(text)) {
    const generic = fboFallbackTier({
      fbos,
      arp,
      source: "FBO_FALLBACK",
      reasonPrefix: "Generic FBO reference → known FBO",
    });
    if (generic) return generic;
  }
  return (
    (await googlePlacesTier({ airport, arp, extraction, env, fetchImpl })) ??
    (await gpt4oTier({ airport, arp, extraction, fbos, aprons: [], env, fetchImpl })) ??
    fboFallbackTier({ fbos, arp })
  );
}
