/**
 * Proof-of-concept: transient parking info extraction
 *
 * Sources: AirNav scrape → Brave Search (website URL) → airport website scrape → Gemini Flash
 * No database. Logs every step. Outputs a JSON summary at the end.
 *
 * Usage:
 *   node scripts/probe-transient-info.js [--airports=KPAO,KSQL,KRHV]
 *
 * Required env:
 *   GEMINI_API_KEY
 *   BRAVE_API_KEY
 */

import "dotenv/config";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_AIRPORTS = ["KPAO", "KSQL", "KRHV"];

const airportArg = process.argv.slice(2).find((a) => a.startsWith("--airports="));
const AIRPORTS = airportArg
  ? airportArg.replace("--airports=", "").toUpperCase().split(",").map((s) => s.trim())
  : DEFAULT_AIRPORTS;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;

if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required");
if (!BRAVE_API_KEY) throw new Error("BRAVE_API_KEY is required");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const results = [];

for (const code of AIRPORTS) {
  log(`\n${"=".repeat(60)}`);
  log(`AIRPORT: ${code}`);
  log("=".repeat(60));

  const result = { code, websiteUrl: null, sources: [], extraction: null, error: null };

  try {
    // Step 1 — AirNav
    log(`\n[1/4] Scraping AirNav for ${code}...`);
    const { text: airnavText, websiteUrl: airnavWebsite } = await scrapeAirNav(code);

    if (airnavText) {
      log(`  -> Got ${airnavText.length} chars of text`);
      log(`  -> Snippet: ${airnavText.slice(0, 200).replace(/\n/g, " ")}...`);
      result.sources.push({ name: "AirNav", text: airnavText });
    } else {
      log(`  -> No text extracted`);
    }

    if (airnavWebsite) {
      log(`  -> Found website in AirNav: ${airnavWebsite}`);
      result.websiteUrl = airnavWebsite;
    } else {
      log(`  -> No website link found in AirNav`);
    }

    // Step 2 — Brave Search for website candidates (if AirNav didn't have one)
    let websiteCandidates = [];
    if (!result.websiteUrl) {
      log(`\n[2/4] Brave Search — finding ${code} airport website...`);
      const { candidates, query, rawResults } = await braveSearchAirportWebsite(code);

      log(`  -> Query: "${query}"`);
      log(`  -> Raw results (top 5):`);
      rawResults.forEach((r, i) => log(`     ${i + 1}. ${r.title} — ${r.url}`));

      websiteCandidates = candidates;
      log(`  -> ${candidates.length} candidate(s) after filtering`);
    } else {
      log(`\n[2/4] Skipping Brave Search — website already found via AirNav`);
      websiteCandidates = [{ url: result.websiteUrl }];
    }

    // Step 3 — Scrape website candidates in ranked order; stop at first success
    log(`\n[3/4] Scraping website candidates...`);
    for (const candidate of websiteCandidates) {
      log(`  -> Trying: ${candidate.url}`);
      const siteText = await scrapeWebpage(candidate.url);

      if (siteText) {
        log(`  -> Got ${siteText.length} chars`);
        log(`  -> Snippet: ${siteText.slice(0, 200).replace(/\n/g, " ")}...`);
        result.websiteUrl = candidate.url;
        result.sources.push({ name: "Website", text: siteText });
        break;
      } else {
        log(`  -> Failed (403/empty) — trying next`);
      }
    }
    if (!result.websiteUrl && websiteCandidates.length > 0) {
      log(`  -> All candidates failed`);
    }

    // Step 4 — Gemini Flash extraction
    if (result.sources.length === 0) {
      log(`\n[4/4] No sources collected — skipping Gemini`);
      result.extraction = null;
    } else {
      log(`\n[4/4] Calling Gemini Flash (${result.sources.length} source(s))...`);
      const prompt = buildPrompt(code, result.sources);
      log(`  -> Prompt length: ${prompt.length} chars`);
      log(`  -> Prompt preview:\n${prompt.slice(0, 400).replace(/^/gm, "     ")}...`);

      const { extraction, rawResponse, tokensUsed } = await callGeminiFlash(prompt);
      log(`  -> Tokens used: ~${tokensUsed}`);
      log(`  -> Raw response: ${rawResponse}`);
      log(`  -> Parsed extraction: ${JSON.stringify(extraction, null, 2)}`);

      result.extraction = extraction;
    }
  } catch (err) {
    log(`\nERROR: ${err.message}`);
    log(err.stack);
    result.error = err.message;
  }

  results.push(result);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

log(`\n${"=".repeat(60)}`);
log("SUMMARY");
log("=".repeat(60));

for (const r of results) {
  log(`\n${r.code}`);
  log(`  website:    ${r.websiteUrl ?? "(none)"}`);
  log(`  sources:    ${r.sources.map((s) => s.name).join(", ") || "(none)"}`);
  if (r.extraction) {
    log(`  confidence: ${r.extraction.confidence ?? "?"}`);
    log(`  notes:      ${r.extraction.notes ?? "(none)"}`);
    log(`  location:   ${r.extraction.locationDescription ?? "(none)"}`);
  } else {
    log(`  extraction: (none)`);
  }
  if (r.error) log(`  error:      ${r.error}`);
}

log("\n--- JSON output ---");
console.log(JSON.stringify(results, null, 2));

// ---------------------------------------------------------------------------
// AirNav scraper
// ---------------------------------------------------------------------------

async function scrapeAirNav(code) {
  const url = `https://www.airnav.com/airport/${code}`;
  log(`  -> Fetching ${url}`);
  const html = await fetchHtml(url);

  if (!html) {
    log(`  -> Fetch returned null (404 or error)`);
    return { text: null, websiteUrl: null };
  }

  log(`  -> HTML length: ${html.length} chars`);

  // Extract official website link
  const websiteMatch =
    html.match(/Official\s+(?:Airport\s+)?Website[^<]*<[^>]+href="(https?:\/\/[^"]+)"/i) ??
    html.match(/href="(https?:\/\/(?!airnav\.com)[^"]{8,})"[^>]*>\s*(?:Official\s+)?Website/i);
  const websiteUrl = websiteMatch?.[1] ?? null;

  const fullText = stripHtml(html);
  log(`  -> Stripped text length: ${fullText.length} chars`);

  // Find the transient/ramp section and extract a window around it
  const idx = fullText.search(/transient|ramp.*parking|tie.?down|overnight/i);
  if (idx === -1) {
    log(`  -> No transient keywords found — returning first 3000 chars`);
    return { text: fullText.slice(0, 3000) || null, websiteUrl };
  }

  log(`  -> Transient keyword found at index ${idx}`);
  const window = fullText.slice(0, 500) + "\n...\n" + fullText.slice(Math.max(0, idx - 300), idx + 3000);
  return { text: window, websiteUrl };
}

// ---------------------------------------------------------------------------
// Brave Search
// ---------------------------------------------------------------------------

async function braveSearchAirportWebsite(code, attempt = 1) {
  const query = `${code} airport official website transient parking`;
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");
  url.searchParams.set("result_filter", "web");

  log(`  -> GET ${url.toString().replace(BRAVE_API_KEY, "***")}`);

  const response = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": BRAVE_API_KEY,
    },
  });

  log(`  -> Response status: ${response.status}`);

  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    const delay = attempt * 3000;
    log(`  -> Rate limited — retrying in ${delay / 1000}s`);
    await new Promise((r) => setTimeout(r, delay));
    return braveSearchAirportWebsite(code, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brave Search HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const items = data.web?.results ?? [];
  const rawResults = items.slice(0, 5).map((r) => ({ title: r.title, url: r.url }));

  // Exclude known aggregators — we want pages with actual airport-specific content
  const isJunk = (u) => /airnav|wikipedia|skyvector|flightaware|yelp|tripadvisor|airportia|airports-worldwide/i.test(u);
  const candidates = items.filter((r) => !isJunk(r.url));

  // Score each candidate — higher is better
  const codeShort = code.replace(/^K/, "");
  function score(r) {
    let s = 0;
    if (/\.gov\//i.test(r.url)) s += 8;                              // Official government operator
    if (/airport\.(org|com|gov|net)/i.test(r.url)) s += 5;          // Airport domain pattern
    if (new RegExp(codeShort, "i").test(r.url)) s += 4;             // Airport code in URL
    if (/transient/i.test(r.url) || /transient/i.test(r.title)) s += 3; // Transient-specific page
    return s;
  }

  const ranked = [...candidates].sort((a, b) => score(b) - score(a));
  log(`  -> Ranked candidates:`);
  ranked.forEach((r, i) => log(`     ${i + 1}. [score ${score(r)}] ${r.url}`));

  return { candidates: ranked, query, rawResults };
}

// ---------------------------------------------------------------------------
// Generic webpage scraper
// ---------------------------------------------------------------------------

async function scrapeWebpage(url, maxChars = 6000) {
  const html = await fetchHtml(url);
  if (!html) return null;
  const text = stripHtml(html);
  return text.slice(0, maxChars) || null;
}

// ---------------------------------------------------------------------------
// Gemini Flash
// ---------------------------------------------------------------------------

function buildPrompt(code, sources) {
  const blocks = sources.map((s) => `### ${s.name}\n${s.text}`).join("\n\n");

  return `You are helping pilots find transient (visitor/overnight) parking at general aviation airports.

Airport: ${code}

Below are text excerpts from multiple sources. Extract ONLY information about where visiting pilots park/tie-down their aircraft (transient ramp, transient hangar, overnight tie-down, self-serve fuel area, costs, restrictions).

${blocks}

Respond with a JSON object (no markdown fences) with these exact fields:
- "notes": string — 1-3 sentences summarising transient parking. null if nothing found.
- "confidence": "HIGH" | "MEDIUM" | "LOW"
- "locationDescription": string | null — plain-language WHERE on the airport (e.g. "north ramp near self-serve fuel"). null if unknown.

If the sources contain no relevant transient parking information, return {"notes":null,"confidence":"LOW","locationDescription":null}.`;
}

async function callGeminiFlash(prompt, attempt = 1) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  log(`  -> Gemini response status: ${response.status}`);

  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    const delay = attempt * 5000;
    log(`  -> Rate limited — retrying in ${delay / 1000}s`);
    await new Promise((r) => setTimeout(r, delay));
    return callGeminiFlash(prompt, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const rawResponse = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const tokensUsed = (data.usageMetadata?.promptTokenCount ?? 0) + (data.usageMetadata?.candidatesTokenCount ?? 0);

  let extraction = null;
  try {
    extraction = JSON.parse(rawResponse.trim());
  } catch {
    const match = rawResponse.match(/\{[\s\S]*\}/);
    if (match) {
      try { extraction = JSON.parse(match[0]); } catch { /* leave null */ }
    }
  }

  return { extraction, rawResponse, tokensUsed };
}

// ---------------------------------------------------------------------------
// HTML utilities
// ---------------------------------------------------------------------------

async function fetchHtml(url, attempt = 1) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
      },
      signal: AbortSignal.timeout(15000),
    });

    log(`  -> ${url} → HTTP ${response.status}`);

    if (response.status === 404) return null;
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const delay = attempt * 3000;
      log(`  -> Error — retrying in ${delay / 1000}s`);
      await new Promise((r) => setTimeout(r, delay));
      return fetchHtml(url, attempt + 1);
    }
    if (!response.ok) return null;

    return response.text();
  } catch (err) {
    log(`  -> Fetch error: ${err.message}`);
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

function log(msg) {
  process.stdout.write(msg + "\n");
}
