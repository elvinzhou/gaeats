import "dotenv/config";
import { createScriptPrisma } from "./lib/db.js";

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(
    "Usage: node scripts/sync-transient-info.js [--airport=KPAO] [--limit=15] [--max-searches=3] [--dry-run]"
  );
  console.log("");
  console.log("  --airport=CODE    Sync a single airport");
  console.log("  --limit=N         Max airports to process per run (default: 15)");
  console.log("  --max-searches=N  Max Google CSE calls per run for URL discovery (default: 3)");
  console.log("  --dry-run         Print what would be written, do not modify DB");
  process.exit(0);
}

const airportFilter = [...args]
  .find((a) => a.startsWith("--airport="))
  ?.replace("--airport=", "")
  .toUpperCase();
const limit = parseInt(
  [...args].find((a) => a.startsWith("--limit="))?.replace("--limit=", "") ?? "15",
  10
);
const maxSearches = parseInt(
  [...args].find((a) => a.startsWith("--max-searches="))?.replace("--max-searches=", "") ?? "3",
  10
);
const dryRun = args.has("--dry-run");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;

if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

const prisma = createScriptPrisma();

try {
  const airports = await listAirportsForTransientSync(airportFilter);

  let cseSearchesUsed = 0;
  let processed = 0;
  let failed = 0;

  for (const airport of airports) {
    console.log(`\n--- ${airport.code} (${airport.name}, ${airport.city} ${airport.state ?? ""}) ---`);

    try {
      // Step 1: Discover airport website if not already known
      let websiteUrl = airport.websiteUrl ?? null;
      if (!websiteUrl) {
        const { url, usedSearch } = await discoverWebsiteUrl(airport, cseSearchesUsed, maxSearches);
        if (usedSearch) cseSearchesUsed++;
        if (url) {
          websiteUrl = url;
          console.log(`  website: ${websiteUrl}`);
          if (!dryRun) {
            await prisma.airport.update({ where: { id: airport.id }, data: { websiteUrl } });
          }
        }
      } else {
        console.log(`  website (cached): ${websiteUrl}`);
      }

      // Step 2: Gather text from all available sources
      const sources = [];
      const sourceNames = [];

      // AirNav
      try {
        const airnavText = await scrapeAirNav(airport.code);
        if (airnavText) {
          sources.push({ name: "AirNav", text: airnavText });
          sourceNames.push("AIRNAV");
          console.log(`  AirNav: ${airnavText.length} chars`);
        }
      } catch (err) {
        console.warn(`  AirNav scrape failed: ${err.message}`);
      }

      // Airport website
      if (websiteUrl) {
        try {
          const siteText = await scrapeWebpage(websiteUrl, 8000);
          if (siteText) {
            sources.push({ name: "Airport website", text: siteText });
            sourceNames.push("WEBSITE");
            console.log(`  airport website: ${siteText.length} chars`);
          }
        } catch (err) {
          console.warn(`  website scrape failed: ${err.message}`);
        }
      }

      if (sources.length === 0) {
        console.log(`  no sources found — skipping`);
        continue;
      }

      // Step 3: Gemini Flash extraction — summarize transient parking info
      const extractionPrompt = buildExtractionPrompt(airport, sources);
      const extraction = await callGeminiFlash(extractionPrompt);

      if (!extraction || !extraction.notes) {
        console.log(`  Gemini: no transient info extracted`);
        continue;
      }

      console.log(`  Gemini confidence: ${extraction.confidence}`);
      console.log(`  Gemini notes: ${extraction.notes.slice(0, 120)}...`);

      // Step 4: GPT-4o coordinate synthesis when confidence is high
      let transientLat = airport.transientLat ?? null;
      let transientLon = airport.transientLon ?? null;

      if (extraction.confidence === "HIGH" && extraction.locationDescription) {
        try {
          const coords = await synthesizeCoordinates(airport, extraction.locationDescription);
          if (coords) {
            transientLat = coords.latitude;
            transientLon = coords.longitude;
            console.log(`  GPT-4o coords: (${transientLat.toFixed(5)}, ${transientLon.toFixed(5)})`);
          }
        } catch (err) {
          console.warn(`  GPT-4o synthesis failed: ${err.message}`);
        }
      }

      if (dryRun) {
        console.log(`  [dry-run] would update transient parking info`);
        processed++;
        continue;
      }

      await prisma.$executeRaw`
        UPDATE "airports" SET
          "transientParkingNotes" = ${extraction.notes},
          "transientParkingSource" = ${sourceNames.join("|")},
          "transientParkingConfidence" = ${extraction.confidence},
          "transientParkingLastSyncAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${airport.id}
      `;

      processed++;
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      failed++;
    }

    // Polite delay between airports — avoids hammering AirNav/POA sequentially
    if (!airportFilter) await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(
    `\nDone — processed: ${processed}  failed: ${failed}  Brave searches used: ${cseSearchesUsed}`
  );
  if (failed > 0) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

// ---------------------------------------------------------------------------
// DB query
// ---------------------------------------------------------------------------

async function listAirportsForTransientSync(airportCode) {
  if (airportCode) {
    return prisma.$queryRaw`
      SELECT
        id, code, name, city, state,
        "websiteUrl",
        "transientParkingLastSyncAt",
        ST_Y(location::geometry) AS latitude,
        ST_X(location::geometry) AS longitude
      FROM "airports"
      WHERE UPPER(code) = UPPER(${airportCode})
    `;
  }

  return prisma.$queryRaw`
    SELECT
      id, code, name, city, state,
      "websiteUrl",
      "transientParkingLastSyncAt",
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude,
      CASE
        WHEN state = 'CA' AND ST_Y(location::geometry) BETWEEN 36.5 AND 39.0
             AND ST_X(location::geometry) BETWEEN -123.5 AND -121.0 THEN 1
        WHEN state IN ('CA', 'OR', 'WA') THEN 2
        ELSE 3
      END AS "regionPriority"
    FROM "airports"
    WHERE ("facilityType" = 'AIRPORT' OR "facilityType" IS NULL)
      AND ("transientStorageHangar" = true OR "transientStorageTiedown" = true OR "facilityType" IS NULL)
      AND (country = 'US' OR country IS NULL)
    ORDER BY
      "transientParkingLastSyncAt" ASC NULLS FIRST,
      "regionPriority" ASC,
      "syncPriority" ASC
    LIMIT ${limit}
  `;
}

// ---------------------------------------------------------------------------
// Website URL discovery
// ---------------------------------------------------------------------------

// Returns { url: string|null, usedSearch: boolean }
async function discoverWebsiteUrl(airport, searchesUsed, maxSearches) {
  // Try AirNav first — it lists official airport website links in its header; free
  try {
    const url = await extractWebsiteFromAirNav(airport.code);
    if (url) return { url, usedSearch: false };
  } catch {
    // fall through
  }

  // Brave Search fallback — 2,000/month free, consume one quota slot
  if (BRAVE_API_KEY && searchesUsed < maxSearches) {
    try {
      const url = await braveSearchAirportWebsite(airport);
      return { url, usedSearch: true };
    } catch (err) {
      console.warn(`  Brave Search failed: ${err.message}`);
      return { url: null, usedSearch: true };
    }
  }

  return { url: null, usedSearch: false };
}

async function extractWebsiteFromAirNav(code) {
  const html = await fetchHtml(`https://www.airnav.com/airport/${code}`);
  if (!html) return null;

  // AirNav includes official website link in a "Website" row
  const match = html.match(/Official\s+(?:Airport\s+)?Website[^<]*<[^>]+href="(https?:\/\/[^"]+)"/i)
    ?? html.match(/href="(https?:\/\/(?!airnav\.com)[^"]{8,})"[^>]*>(?:Official\s+)?Website/i);
  return match?.[1] ?? null;
}

async function braveSearchAirportWebsite(airport, attempt = 1) {
  const query = `${airport.name} ${airport.code} airport official website`;
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");
  url.searchParams.set("result_filter", "web");

  const response = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": BRAVE_API_KEY,
    },
  });

  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, attempt * 3000));
    return braveSearchAirportWebsite(airport, attempt + 1);
  }

  if (!response.ok) throw new Error(`Brave Search HTTP ${response.status}`);

  const data = await response.json();
  const results = data.web?.results ?? [];

  const isJunk = (u) => /airnav|wikipedia|skyvector|flightaware|yelp|tripadvisor/i.test(u);
  const codePattern = new RegExp(airport.code.replace(/^K/, ""), "i");
  const preferred = results.find((r) => !isJunk(r.url) && (codePattern.test(r.url) || /airport\.(org|com|gov|net)/.test(r.url)));
  const fallback = results.find((r) => !isJunk(r.url));
  return preferred?.url ?? fallback?.url ?? null;
}

// ---------------------------------------------------------------------------
// Scrapers
// ---------------------------------------------------------------------------

async function scrapeAirNav(code) {
  const html = await fetchHtml(`https://www.airnav.com/airport/${code}`);
  if (!html) return null;

  const text = stripHtml(html);

  // Extract the section around transient/ramp/parking comments
  const idx = text.search(/transient|ramp|parking|overnight|tie.?down/i);
  if (idx === -1) return text.slice(0, 4000);

  // Return a window around the relevant section plus a preamble
  return text.slice(0, 500) + "\n...\n" + text.slice(Math.max(0, idx - 200), idx + 3000);
}

async function scrapeWebpage(url, maxChars = 6000) {
  const html = await fetchHtml(url);
  if (!html) return null;
  const text = stripHtml(html);
  return text.slice(0, maxChars) || null;
}

// ---------------------------------------------------------------------------
// LLM calls
// ---------------------------------------------------------------------------

function buildExtractionPrompt(airport, sources) {
  const sourceBlocks = sources
    .map((s) => `### ${s.name}\n${s.text}`)
    .join("\n\n");

  return `You are helping pilots find transient (overnight/short-term visitor) parking at general aviation airports.

Airport: ${airport.code} — ${airport.name}, ${airport.city}, ${airport.state ?? ""}
Coordinates: ${Number(airport.latitude).toFixed(5)}, ${Number(airport.longitude).toFixed(5)}

Below are text excerpts from multiple sources about this airport. Extract ONLY information about where visiting pilots can park/tie-down their aircraft (transient ramp, transient hangar, overnight tie-down, etc).

${sourceBlocks}

Respond with a JSON object (no markdown fences) with these fields:
- "notes": string — a 1-3 sentence summary of where transient aircraft park, costs if mentioned, any restrictions. null if no info found.
- "confidence": "HIGH" | "MEDIUM" | "LOW" — how confident you are in the notes.
- "locationDescription": string | null — a plain-language description of WHERE on the airport the transient area is (e.g. "north ramp near the self-serve fuel", "main FBO on the west side"). null if unknown.

If the sources contain no relevant transient parking information, return {"notes": null, "confidence": "LOW", "locationDescription": null}.`;
}

async function callGeminiFlash(prompt, attempt = 1) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 512,
        },
      }),
    }
  );

  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, attempt * 5000));
    return callGeminiFlash(prompt, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  try {
    return JSON.parse(text.trim());
  } catch {
    // Try to extract JSON from the response text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    console.warn(`  Gemini returned non-JSON: ${text.slice(0, 100)}`);
    return null;
  }
}

async function synthesizeCoordinates(airport, locationDescription) {
  // Feed GPT-4o the airport's ARP, the location description, and ask it to
  // reason about a likely transient ramp coordinate.
  const systemPrompt = `You are a navigation assistant helping place a GPS coordinate for the transient aircraft parking area at a general aviation airport. You will be given the airport's reference point (ARP) coordinates and a plain-language description of where transient parking is located relative to the airport. Return a JSON object with "latitude" and "longitude" as decimal degrees, and "reasoning" as a brief explanation. If you cannot make a reasonable estimate, return {"latitude": null, "longitude": null, "reasoning": "..."}. Respond with raw JSON only, no markdown.`;

  const userPrompt = `Airport: ${airport.code} — ${airport.name}
Airport Reference Point (ARP): ${Number(airport.latitude).toFixed(6)}, ${Number(airport.longitude).toFixed(6)}
Transient area description: "${locationDescription}"

Estimate the GPS coordinate of the transient parking/ramp area.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 256,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? "";

  try {
    const parsed = JSON.parse(text.trim());
    if (parsed.latitude != null && parsed.longitude != null) {
      return { latitude: parsed.latitude, longitude: parsed.longitude };
    }
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.latitude != null && parsed.longitude != null) {
          return { latitude: parsed.latitude, longitude: parsed.longitude };
        }
      } catch {
        // fall through
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// HTML utilities
// ---------------------------------------------------------------------------

async function fetchHtml(url, attempt = 1) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; gaeats-sync/1.0; +https://gaeats.com)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 404) return null;
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt * 3000));
      return fetchHtml(url, attempt + 1);
    }
    if (!response.ok) return null;

    return response.text();
  } catch {
    return null;
  }
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}
