import { describe, expect, it } from "vitest";
import { extractResponseText, parseJson } from "./gemini-utils.js";

describe("extractResponseText", () => {
  it("reads text from a deserialized batch response (no .text getter)", () => {
    // Shape returned by ai.batches.get(): a plain object, so `.text` is undefined.
    // Reading `.text` here is the trap that caused "no transient info found".
    const response = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: '{"notes":"Park at the south ramp","confidence":"HIGH"}' }],
          },
        },
      ],
    };

    expect(response.text).toBeUndefined();
    expect(extractResponseText(response)).toBe(
      '{"notes":"Park at the south ramp","confidence":"HIGH"}'
    );
  });

  it("concatenates multiple text parts", () => {
    const response = {
      candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }],
    };
    expect(extractResponseText(response)).toBe("ab");
  });

  it("skips thinking/thought parts", () => {
    const response = {
      candidates: [
        { content: { parts: [{ text: "internal reasoning", thought: true }, { text: "answer" }] } },
      ],
    };
    expect(extractResponseText(response)).toBe("answer");
  });

  it("returns an empty string when candidates or parts are missing", () => {
    expect(extractResponseText(undefined)).toBe("");
    expect(extractResponseText({})).toBe("");
    expect(extractResponseText({ candidates: [] })).toBe("");
    expect(extractResponseText({ candidates: [{ content: {} }] })).toBe("");
  });
});

describe("parseJson", () => {
  it("parses raw JSON", () => {
    expect(parseJson('{"notes":"x","confidence":"HIGH"}')).toEqual({
      notes: "x",
      confidence: "HIGH",
    });
  });

  it("parses JSON wrapped in markdown fences", () => {
    expect(parseJson('```json\n{"notes":"x"}\n```')).toEqual({ notes: "x" });
  });

  it("extracts JSON embedded in surrounding prose", () => {
    expect(parseJson('Here you go: {"notes":"x"} — done')).toEqual({ notes: "x" });
  });

  it("returns null for unparseable or empty text", () => {
    expect(parseJson("")).toBeNull();
    expect(parseJson("not json at all")).toBeNull();
  });
});
