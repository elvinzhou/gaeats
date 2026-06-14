import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regression guard for the Google Maps + Tailwind CSS conflict fix.
 *
 * Tailwind's Preflight reset applies `img { max-width: 100% }` and
 * `box-sizing: border-box` to every element on the page. Google Maps renders
 * its own tiles, markers, controls and info windows inside the map container
 * and assumes the browser default box model. Under Tailwind's reset the tiles
 * are distorted and the markers are mis-projected — they appear in the wrong
 * location, cluster together, and do not stay anchored to the map while it is
 * panned.
 *
 * The fix has two halves that must stay in sync:
 *   1. the <Map> element carries the `google-maps-container` class, and
 *   2. app.css scopes a CSS reset to that class.
 *
 * The map only renders meaningfully against the real Google Maps JS API in a
 * browser (with an API key), which the `node` test environment cannot provide.
 * These tests therefore assert the contract between the component and the
 * stylesheet so the fix cannot be removed unnoticed.
 */

const root = resolve(__dirname, "../../..");
const componentSrc = readFileSync(
  resolve(root, "app/components/GoogleMapComponent.tsx"),
  "utf8"
);
const appCss = readFileSync(resolve(root, "app/app.css"), "utf8");

describe("Google Maps Tailwind CSS conflict fix", () => {
  it("scopes the CSS reset class onto the <Map> element", () => {
    // The class must live on a className so it lands on the div Google Maps
    // mounts its internal DOM into, allowing the reset to cascade inward.
    expect(componentSrc).toMatch(
      /className=("|'|`)[^"'`]*\bgoogle-maps-container\b/
    );
  });

  it("removes Tailwind's img max-width constraint inside the map", () => {
    // `img { max-width: 100% }` squashes Google Maps tiles and marker imagery;
    // Google's documented fix is `max-width: none` within the map container.
    expect(appCss).toMatch(
      /\.google-maps-container\s+img\s*\{[^}]*max-width:\s*none/
    );
  });

  it("restores the content-box box model inside the map", () => {
    // Tailwind forces `box-sizing: border-box` on every element; Google Maps
    // expects the browser default (`content-box`) for correct projection.
    expect(appCss).toMatch(
      /\.google-maps-container[^{]*\{[^}]*box-sizing:\s*content-box/
    );
  });
});
