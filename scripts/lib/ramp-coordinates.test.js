import { describe, it, expect, vi } from "vitest";
import {
  haversineMeters,
  significantTokens,
  matchFboInText,
  mentionsFbo,
  mentionsTransientRamp,
  isEssentiallyArp,
  isPlausibleRamp,
  chooseFboFallback,
  parseCardinalBearing,
  bearingDegrees,
  angularDifference,
  chooseApron,
  fetchOsmAprons,
  resolveRampCoordinates,
} from "./ramp-coordinates.js";

// A small fictional field. ARP sits at the runway centre; the FBOs are a few
// hundred metres off to the sides, like a real GA airport.
const ARP = { latitude: 37.5, longitude: -122.0 };
const airport = { code: "KXYZ", name: "Test Field", ...ARP };
const SIGNATURE = { name: "Signature Flight Support", latitude: 37.502, longitude: -122.003 };
const ATLANTIC = { name: "Atlantic Aviation", latitude: 37.49, longitude: -121.99 };

// Apron centroids around the ARP (north / south / east, plus a named one).
const apronN = { name: null, latitude: 37.506, longitude: -122.0 };
const apronS = { name: null, latitude: 37.492, longitude: -122.0 };
const apronE = { name: null, latitude: 37.5, longitude: -121.985 };
const apronTransient = { name: "Transient Apron", latitude: 37.5, longitude: -122.012 };

/** A fetch stub that branches on URL; throws if a tier we didn't stub is reached. */
function makeFetch({ openai, google, osm } = {}) {
  return vi.fn(async (url) => {
    if (typeof url === "string" && url.includes("openai.com")) {
      if (!openai) throw new Error("OpenAI not stubbed");
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(openai) } }] }) };
    }
    if (typeof url === "string" && url.includes("places.googleapis.com")) {
      if (!google) throw new Error("Google Places not stubbed");
      return {
        ok: true,
        json: async () => ({
          places: [{ displayName: { text: google.name ?? "Result" }, location: { latitude: google.latitude, longitude: google.longitude } }],
        }),
      };
    }
    if (typeof url === "string" && url.includes("overpass-api.de")) {
      // Overpass returns way/relation centroids under `center` when `out center`
      // is requested. Default to no aprons when the test didn't stub any.
      const elements = (osm ?? []).map((a) => ({
        type: "way",
        center: { lat: a.latitude, lon: a.longitude },
        tags: a.name ? { aeroway: "apron", name: a.name } : { aeroway: "apron" },
      }));
      return { ok: true, json: async () => ({ elements }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

const failFetch = vi.fn(() => {
  throw new Error("fetch should not have been called");
});

describe("haversineMeters", () => {
  it("is zero for identical points", () => {
    expect(haversineMeters(ARP, ARP)).toBe(0);
  });

  it("computes ~111 km for one degree of longitude at the equator", () => {
    const d = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
    expect(d).toBeGreaterThan(111000);
    expect(d).toBeLessThan(111400);
  });
});

describe("significantTokens", () => {
  it("strips generic aviation words, leaving the brand", () => {
    expect(significantTokens("Signature Flight Support")).toEqual(["signature"]);
    expect(significantTokens("Atlantic Aviation")).toEqual(["atlantic"]);
    expect(significantTokens("Million Air")).toEqual(["million"]); // "air" is generic
  });

  it("returns no tokens for a name with only generic words", () => {
    expect(significantTokens("FBO")).toEqual([]);
    expect(significantTokens("General Aviation Terminal")).toEqual([]);
  });
});

describe("matchFboInText", () => {
  const fbos = [SIGNATURE, ATLANTIC];

  it("matches the FBO named in the description", () => {
    const m = matchFboInText({ text: "Transient parking on the ramp in front of Signature.", fbos });
    expect(m?.fbo).toBe(SIGNATURE);
  });

  it("does not match when no FBO brand appears", () => {
    expect(matchFboInText({ text: "Park on the south tie-down apron.", fbos })).toBeNull();
  });

  it("ignores generic tokens like 'air' so the right brand wins", () => {
    const m = matchFboInText({ text: "Visitors use the Million Air ramp.", fbos: [{ name: "Million Air", latitude: 1, longitude: 2 }, ATLANTIC] });
    expect(m?.fbo.name).toBe("Million Air");
  });

  it("returns null for empty text or no FBOs", () => {
    expect(matchFboInText({ text: "", fbos })).toBeNull();
    expect(matchFboInText({ text: "Signature", fbos: [] })).toBeNull();
  });
});

describe("mentions helpers", () => {
  it("detects FBO references", () => {
    expect(mentionsFbo("park at the FBO")).toBe(true);
    expect(mentionsFbo("fixed-base operator on the east side")).toBe(true);
    expect(mentionsFbo("south tie-downs")).toBe(false);
  });

  it("detects ramp/apron references", () => {
    expect(mentionsTransientRamp("the north ramp")).toBe(true);
    expect(mentionsTransientRamp("east apron")).toBe(true);
    expect(mentionsTransientRamp("tie-downs available")).toBe(true);
    expect(mentionsTransientRamp("call ahead for parking")).toBe(false);
  });
});

describe("coordinate guards", () => {
  it("isEssentiallyArp flags points at/near the ARP", () => {
    expect(isEssentiallyArp({ latitude: 37.5, longitude: -122.0 }, ARP)).toBe(true);
    expect(isEssentiallyArp({ latitude: 37.5004, longitude: -122.0 }, ARP)).toBe(true); // ~44 m
    expect(isEssentiallyArp({ latitude: 37.505, longitude: -122.0 }, ARP)).toBe(false); // ~550 m
  });

  it("isPlausibleRamp rejects invalid, out-of-range, and far-flung points", () => {
    expect(isPlausibleRamp(SIGNATURE, ARP)).toBe(true);
    expect(isPlausibleRamp({ latitude: NaN, longitude: -122 }, ARP)).toBe(false);
    expect(isPlausibleRamp({ latitude: 200, longitude: -122 }, ARP)).toBe(false);
    expect(isPlausibleRamp({ latitude: 40.0, longitude: -122.0 }, ARP)).toBe(false); // ~280 km away
  });
});

describe("chooseFboFallback", () => {
  it("returns the only FBO when there is one", () => {
    expect(chooseFboFallback([SIGNATURE], ARP)).toBe(SIGNATURE);
  });

  it("returns the FBO closest to the ARP when there are several", () => {
    expect(chooseFboFallback([ATLANTIC, SIGNATURE], ARP)).toBe(SIGNATURE);
  });

  it("returns null when there are no valid FBOs", () => {
    expect(chooseFboFallback([], ARP)).toBeNull();
    expect(chooseFboFallback([{ name: "x", latitude: NaN, longitude: 1 }], ARP)).toBeNull();
  });
});

describe("parseCardinalBearing", () => {
  it("maps direction words to compass bearings", () => {
    expect(parseCardinalBearing("south ramp")).toBe(180);
    expect(parseCardinalBearing("the northern tie-downs")).toBe(0);
    expect(parseCardinalBearing("northeast apron")).toBe(45);
    expect(parseCardinalBearing("southwest corner")).toBe(225);
  });

  it("prefers a compound direction over the single it contains", () => {
    expect(parseCardinalBearing("northeast")).toBe(45); // not 0 (north)
  });

  it("returns null when no direction is named", () => {
    expect(parseCardinalBearing("on the main ramp")).toBeNull();
  });
});

describe("bearingDegrees / angularDifference", () => {
  it("reads ~0° heading north and ~90° heading east from the ARP", () => {
    expect(bearingDegrees(ARP, { latitude: 37.51, longitude: -122.0 })).toBeCloseTo(0, 0);
    expect(bearingDegrees(ARP, { latitude: 37.5, longitude: -121.99 })).toBeCloseTo(90, 0);
  });

  it("wraps around 360°", () => {
    expect(angularDifference(350, 10)).toBe(20);
    expect(angularDifference(0, 180)).toBe(180);
  });
});

describe("chooseApron", () => {
  const aprons = [apronN, apronS, apronE];

  it("picks the apron on the named cardinal side", () => {
    expect(chooseApron({ aprons, text: "south transient ramp", arp: ARP })).toBe(apronS);
    expect(chooseApron({ aprons, text: "north ramp", arp: ARP })).toBe(apronN);
  });

  it("picks the apron in front of the matched FBO when no side is named", () => {
    expect(chooseApron({ aprons, text: "ramp by the operator", arp: ARP, matchedFbo: SIGNATURE })).toBe(apronN);
  });

  it("prefers an apron tagged for transient/GA use", () => {
    expect(chooseApron({ aprons: [apronN, apronTransient], text: "park on the ramp", arp: ARP })).toBe(apronTransient);
  });

  it("falls back to the apron nearest the ARP", () => {
    expect(chooseApron({ aprons, text: "on the ramp", arp: ARP })).toBe(apronN);
  });

  it("returns null when there are no aprons", () => {
    expect(chooseApron({ aprons: [], text: "south ramp", arp: ARP })).toBeNull();
  });
});

describe("fetchOsmAprons", () => {
  it("parses Overpass centroids into apron records", async () => {
    const fetchImpl = makeFetch({ osm: [apronS, apronTransient] });
    const aprons = await fetchOsmAprons({ arp: ARP, fetchImpl });
    expect(aprons).toHaveLength(2);
    expect(aprons[0]).toMatchObject({ latitude: apronS.latitude, longitude: apronS.longitude });
    expect(aprons.find((a) => a.name === "Transient Apron")).toBeTruthy();
  });
});

describe("resolveRampCoordinates", () => {
  it("FBO-first: snaps to a named FBO (no distinct ramp) without any network call", async () => {
    const res = await resolveRampCoordinates({
      airport,
      extraction: { locationDescription: "Visiting aircraft park in front of Signature.", fboName: "Signature Flight Support" },
      fbos: [SIGNATURE, ATLANTIC],
      env: { OPENAI_API_KEY: "k", GOOGLE_MAPS_SERVER_API_KEY: "k" },
      fetchImpl: failFetch,
    });
    expect(res).toMatchObject({ latitude: SIGNATURE.latitude, longitude: SIGNATURE.longitude, source: "FBO_MATCH" });
    expect(failFetch).not.toHaveBeenCalled();
  });

  it("ramp-first: prefers the transient ramp (OSM apron) over the FBO when both exist", async () => {
    // Description names an FBO AND a south transient ramp — the ramp must win.
    const fetchImpl = makeFetch({ osm: [apronN, apronS, apronE] });
    const res = await resolveRampCoordinates({
      airport,
      extraction: { locationDescription: "Transient parking on the south ramp.", fboName: "Signature Flight Support" },
      fbos: [SIGNATURE, ATLANTIC],
      env: {},
      fetchImpl,
    });
    expect(res).toMatchObject({ source: "OSM_APRON", latitude: apronS.latitude, longitude: apronS.longitude });
  });

  it("ramp-first: falls back to the FBO when the ramp can't be located", async () => {
    // OSM has no aprons (default empty) and there are no API keys → FBO proxy.
    const res = await resolveRampCoordinates({
      airport,
      extraction: { locationDescription: "Transient parking on the ramp by Signature.", fboName: "Signature Flight Support" },
      fbos: [SIGNATURE, ATLANTIC],
      env: {},
      fetchImpl: makeFetch({}),
    });
    expect(res).toMatchObject({ source: "FBO_MATCH", latitude: SIGNATURE.latitude });
  });

  it("Tier 2: generic 'FBO' reference falls back to the nearest known FBO", async () => {
    const res = await resolveRampCoordinates({
      airport,
      extraction: { locationDescription: "Visiting aircraft park at the FBO; self-serve fuel." },
      fbos: [ATLANTIC, SIGNATURE],
      env: {},
      fetchImpl: failFetch,
    });
    expect(res).toMatchObject({ source: "FBO_FALLBACK", latitude: SIGNATURE.latitude });
  });

  it("Tier 3: geocodes via Google Places for a ramp-only description", async () => {
    const fetchImpl = makeFetch({ google: { latitude: 37.504, longitude: -122.002, name: "South Ramp" } });
    const res = await resolveRampCoordinates({
      airport,
      extraction: { locationDescription: "South transient apron." },
      fbos: [],
      env: { GOOGLE_MAPS_SERVER_API_KEY: "k" },
      fetchImpl,
    });
    expect(res).toMatchObject({ source: "GOOGLE_PLACES", latitude: 37.504 });
  });

  it("Tier 4: uses an anchored GPT-4o estimate when it is meaningfully off the ARP", async () => {
    const fetchImpl = makeFetch({ openai: { latitude: 37.495, longitude: -122.0, reasoning: "south" } });
    const res = await resolveRampCoordinates({
      airport,
      extraction: { locationDescription: "South tie-down ramp." },
      fbos: [],
      env: { OPENAI_API_KEY: "k" },
      fetchImpl,
    });
    expect(res).toMatchObject({ source: "GPT4O", latitude: 37.495 });
  });

  it("rejects a GPT-4o answer that is essentially the ARP and falls back to a known FBO", async () => {
    // This is the exact failure mode being fixed: the model echoes the airport back.
    const fetchImpl = makeFetch({ openai: { latitude: 37.5, longitude: -122.0, reasoning: "airport center" } });
    const res = await resolveRampCoordinates({
      airport,
      extraction: { locationDescription: "Transient parking on the field." },
      fbos: [SIGNATURE],
      env: { OPENAI_API_KEY: "k" },
      fetchImpl,
    });
    expect(res).toMatchObject({ source: "FBO_NEAREST", latitude: SIGNATURE.latitude });
  });

  it("returns null when the ARP-echo is rejected and there is no FBO to fall back to", async () => {
    const fetchImpl = makeFetch({ openai: { latitude: 37.5, longitude: -122.0 } });
    const res = await resolveRampCoordinates({
      airport,
      extraction: { locationDescription: "Transient parking on the field." },
      fbos: [],
      env: { OPENAI_API_KEY: "k" },
      fetchImpl,
    });
    expect(res).toBeNull();
  });

  it("falls back to a known FBO when no API keys are configured", async () => {
    const res = await resolveRampCoordinates({
      airport,
      extraction: { locationDescription: "South tie-down ramp." },
      fbos: [SIGNATURE],
      env: {},
      fetchImpl: failFetch,
    });
    expect(res).toMatchObject({ source: "FBO_NEAREST" });
  });
});
