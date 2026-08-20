import { describe, expect, it } from "vitest";
import {
  feedbackKey,
  feedbackKeyForWords,
  filterCandidates,
  isSolved,
  createLetterMask,
  precomputeLetterMasks,
  scoreGuess,
} from "../src/feedback.js";

describe("Votee feedback semantics", () => {
  it("scores correct, present, and absent letters", () => {
    expect(feedbackKey(scoreGuess("wrote", "raise"))).toBe("paaac");
  });

  it("matches Votee's non-consuming duplicate-letter behavior", () => {
    expect(scoreGuess("apple", "allee").map(({ result }) => result)).toEqual([
      "correct",
      "present",
      "present",
      "present",
      "correct",
    ]);
    expect(feedbackKeyForWords("apple", "allee")).toBe("cpppc");
  });

  it("precomputes one 26-bit presence mask per word", () => {
    const masks = precomputeLetterMasks(["apple", "wrote"]);

    expect(masks.get("apple")).toBe(createLetterMask("pale"));
    expect(masks.get("apple")).not.toBe(createLetterMask("apply"));
    expect(feedbackKeyForWords("apple", "allee", masks.get("apple"))).toBe("cpppc");
  });

  it("rejects non-ASCII mask input", () => {
    expect(() => createLetterMask("café")).toThrow(/non-ASCII/);
  });

  it("keeps exactly the candidates matching the entire feedback pattern", () => {
    const feedback = scoreGuess("wrote", "raise");
    expect(filterCandidates(["wrote", "route", "crone", "stare"], "raise", feedback)).toEqual([
      "wrote",
      "crone",
    ]);
  });

  it("recognizes only an all-correct non-empty result as solved", () => {
    expect(isSolved(scoreGuess("apple", "apple"))).toBe(true);
    expect(isSolved(scoreGuess("apple", "apply"))).toBe(false);
    expect(isSolved([])).toBe(false);
  });

  it("rejects mismatched lengths", () => {
    expect(() => scoreGuess("apple", "pear")).toThrow(/same length/);
  });
});
