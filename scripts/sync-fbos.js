import "dotenv/config";
import { createScriptPrisma } from "./lib/db.js";
import { listAirportsForFboSync, upsertAirportFbo } from "./lib/postgis.js";

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(
    "Usage: node scripts/sync-fbos.js [--airport=KPAO] [--limit=50] [--dry-run] [--force] [--osm-only] [--google-only]"
  );
  console.log("");
  console.log("  --airport=CODE  Sync a single airport (ignores --limit and --force filter)");
  console.log("  --limit=N       Max airports to process per run (default: 50)");
  console.log("  --dry-run       Print what would be written, do not modify DB");
  console.log("  --force         Re-sync airports that already have FBO records");
  console.log("  --osm-only      Skip Google Places fallback");
  console.log("  --google-only   Skip OSM, always use Google Places");
  process.exit(0);
}

const airportFilter = [...args]
  .find((a) => a.startsWith("--airport="))
  ?.replace("--airport=", "")
  .toUpperCase();
const limit = parseInt(
  [...args].find((a) => a.startsWith("--limit="))?.replace("--limit=", "") ?? "50",
  10
);
const dryRun = args.has("--dry-run");
const force = args.has("--force");
const osmOnly = args.has("--osm-only");
const googleOnly = args.has("--google-only");

const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;

if (!osmOnly && !apiKey) {
  console.warn("GOOGLE_MAPS_SERVER_API_KEY not set — OSM only.");
}

// Regex matching major US FBO brands and generic FBO terms.
// Tested against Overpass QL (which uses ERE) and JS RegExp — syntax is compatible.
const FBO_NAME_PATTERN =
  "Signature Flight|Signature Aviation|Atlantic Aviation|Sheltair|Jet Aviation|Million Air|Avflight|Ross Aviation|Rectrix|Banyan Air|Silverhawk|TAC Air|Landmark Aviation|Cutter Aviation|Galaxy Aviation|Meridian|Galaxy FBO|Combs|Mustang Aviation|Falcon Aviation|Endeavour|Execair|Fly.In|American Aero|Superior Air|fixed.base|general aviation|GA terminal|\\bFBO\\b";
const FBO_NAME_REGEX = new RegExp(FBO_NAME_PATTERN, "i");

const prisma = createScriptPrisma();

try {
  const allAirports = await listAirportsForFboSync(prisma, airportFilter);

  const airports = airportFilter
    ? allAirports
    : allAirports.filter((a) => force || !a.hasFbos).slice(0, limit);

  console.log(`Syncing FBOs for ${airports.length} airport(s) (${allAirports.length} eligible total)`);

  let osmHits = 0;
  let googleHits = 0;
  let notFound = 0;
  let failed = 0;

  for (const airport of airports) {
    let fbos = [];
    let source = null;

    // 1. OSM Overpass — free, no quota
    if (!googleOnly) {
      try {
        const osmResults = await queryOsmFbos(airport);
        if (osmResults.length > 0) {
          fbos = osmResults;
          source = "OSM";
          osmHits++;
          console.log(`${airport.code}: ${fbos.length} FBO(s) via OSM`);
        }
      } catch (err) {
        console.warn(`${airport.code}: OSM error — ${err.message}`);
      }
    }

    // 2. Google Places fallback — ~$0.017/call
    if (fbos.length === 0 && !osmOnly && apiKey) {
      try {
        const googleResults = await queryGoogleFbos(airport, apiKey);
        if (googleResults.length > 0) {
          fbos = googleResults;
          source = "GOOGLE";
          googleHits++;
          console.log(`${airport.code}: ${fbos.length} FBO(s) via Google`);
        }
      } catch (err) {
        console.warn(`${airport.code}: Google error — ${err.message}`);
        failed++;
        continue;
      }
    }

    if (fbos.length === 0) {
      console.log(`${airport.code}: no FBOs found`);
      notFound++;
      continue;
    }

    if (dryRun) {
      for (const fbo of fbos) {
        console.log(
          `[dry-run] ${airport.code}: "${fbo.name}" (${fbo.latitude.toFixed(5)}, ${fbo.longitude.toFixed(5)}) [${source}]`
        );
      }
      continue;
    }

    for (const fbo of fbos) {
      await upsertAirportFbo(prisma, {
        airportId: airport.id,
        name: fbo.name,
        placeId: fbo.placeId ?? null,
        latitude: fbo.latitude,
        longitude: fbo.longitude,
        source,
      });
    }
  }

  console.log(
    `\nDone — OSM: ${osmHits}  Google: ${googleHits}  Not found: ${notFound}  Failed: ${failed}`
  );
  if (failed > 0) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

// ---------------------------------------------------------------------------
// OSM Overpass
// ---------------------------------------------------------------------------

async function queryOsmFbos(airport, attempt = 1) {
  const { latitude: lat, longitude: lon } = airport;
  const radius = 2000;

  // Two passes:
  // 1. Aeroway-tagged features (terminals, hangars, fuel) whose name matches FBO brands.
  // 2. Any aeroway-tagged feature whose name contains generic FBO terms.
  // Using Overpass ERE — the brand list is a | alternation without JS-specific syntax.
  const brandAlts =
    "Signature|Atlantic Aviation|Sheltair|Jet Aviation|Million Air|Avflight|Ross Aviation|Rectrix|Banyan|Silverhawk|TAC Air|Landmark|Cutter|Galaxy|Meridian|Combs|Mustang|Falcon|Endeavour|Execair|American Aero|Superior Air";

  const query = `
[out:json][timeout:30];
(
  node["aeroway"~"terminal|hangar|fuel|services"]["name"~"${brandAlts}"](around:${radius},${lat},${lon});
  way["aeroway"~"terminal|hangar|fuel|services"]["name"~"${brandAlts}"](around:${radius},${lat},${lon});
  node["aeroway"]["name"~"FBO|fixed base|general aviation|GA terminal"](around:${radius},${lat},${lon});
  way["aeroway"]["name"~"FBO|fixed base|general aviation|GA terminal"](around:${radius},${lat},${lon});
);
out center;
`.trim();

  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (response.status === 429 && attempt < 3) {
    const delay = attempt * 15000;
    console.warn(`OSM rate limited — retrying in ${delay / 1000}s`);
    await new Promise((r) => setTimeout(r, delay));
    return queryOsmFbos(airport, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`Overpass HTTP ${response.status}`);
  }

  const data = await response.json();

  return (data.elements ?? [])
    .map((el) => {
      const name = el.tags?.name;
      if (!name) return null;
      const lat = el.type === "way" ? el.center?.lat : el.lat;
      const lon = el.type === "way" ? el.center?.lon : el.lon;
      if (lat == null || lon == null) return null;
      return { name, latitude: lat, longitude: lon, placeId: null };
    })
    .filter(Boolean)
    .filter((fbo) => FBO_NAME_REGEX.test(fbo.name));
}

// ---------------------------------------------------------------------------
// Google Places (New)
// ---------------------------------------------------------------------------

// Field mask for FBO searches — Basic tier ($0.017/call).
// We only need id, displayName, location to store the FBO record.
const GOOGLE_FIELD_MASK = "places.id,places.displayName,places.location";

async function queryGoogleFbos(airport, apiKey) {
  const { latitude, longitude, fboName, city, state, code } = airport;
  let places = [];

  // Pass 1 — targeted text search if we have a stored FBO name
  if (fboName) {
    const query = `${fboName} ${city} ${state ?? ""} ${code}`.trim();
    places = await googleSearchText(query, { latitude, longitude }, 3000, apiKey);
  }

  // Pass 2 — generic nearby search if targeted search found nothing
  if (places.length === 0) {
    places = await googleSearchNearby({ latitude, longitude }, 2000, apiKey);
  }

  // Filter to FBO-named places only
  return places
    .filter((p) => {
      const name = p.displayName?.text ?? "";
      return FBO_NAME_REGEX.test(name);
    })
    .map((p) => ({
      name: p.displayName.text,
      latitude: p.location.latitude,
      longitude: p.location.longitude,
      placeId: p.id,
    }));
}

async function googleSearchText(textQuery, locationBias, radius, apiKey, attempt = 1) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      locationBias: {
        circle: {
          center: { latitude: locationBias.latitude, longitude: locationBias.longitude },
          radius,
        },
      },
      maxResultCount: 5,
    }),
  });

  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, attempt * 2000));
    return googleSearchText(textQuery, locationBias, radius, apiKey, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google searchText ${response.status}: ${body}`);
  }

  const payload = await response.json();
  return payload.places ?? [];
}

async function googleSearchNearby(center, radius, apiKey, attempt = 1) {
  // airport type catches GA terminals that Google Places classifies under airport
  const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: ["airport"],
      maxResultCount: 10,
      locationRestriction: {
        circle: {
          center: { latitude: center.latitude, longitude: center.longitude },
          radius,
        },
      },
    }),
  });

  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, attempt * 2000));
    return googleSearchNearby(center, radius, apiKey, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google searchNearby ${response.status}: ${body}`);
  }

  const payload = await response.json();
  return payload.places ?? [];
}
