import { describe, expect, it } from "vitest";
import {
  createLetterMask,
  feedbackKey,
  feedbackKeyForWords,
  precomputeLetterMasks,
  scoreGuess,
} from "../src/feedback.js";

describe("production feedback edge cases", () => {
  it("uses Votee's non-consuming rule when a guess repeats a target letter", () => {
    const feedback = scoreGuess("cigar", "rarer");

    expect(feedback).toEqual([
      { slot: 0, guess: "r", result: "present" },
      { slot: 1, guess: "a", result: "present" },
      { slot: 2, guess: "r", result: "present" },
      { slot: 3, guess: "e", result: "absent" },
      { slot: 4, guess: "r", result: "correct" },
    ]);
    expect(feedbackKey(feedback)).toBe("pppac");
  });

  it("normalizes mixed-case targets and guesses before scoring", () => {
    const feedback = scoreGuess("RaTeR", "rAtEl");

    expect(feedback.map(({ guess }) => guess).join("")).toBe("ratel");
    expect(feedbackKey(feedback)).toBe("cccca");
    expect(feedbackKeyForWords("RATER", "RATEL")).toBe("cccca");
  });

  it("sets only the A and Z bits for repeated endpoint letters", () => {
    const expectedEndpointMask = (1 << 0) | (1 << 25);
    const masks = precomputeLetterMasks(["AaZz", "zaza"]);

    expect(createLetterMask("AaZzAa")).toBe(expectedEndpointMask);
    expect(masks.get("AaZz")).toBe(expectedEndpointMask);
    expect(masks.get("zaza")).toBe(expectedEndpointMask);
  });

  it("rejects unequal lengths and non-ASCII target-mask input", () => {
    expect(() => scoreGuess("apple", "pear")).toThrow(
      "Target and guess must have the same length (got 5 and 4).",
    );
    expect(() => feedbackKeyForWords("pear", "apple")).toThrow(
      "Target and guess must have the same length (got 4 and 5).",
    );
    expect(() => createLetterMask("cafés")).toThrow(/non-ASCII word: cafés/);
    expect(() => scoreGuess("cafés", "capes")).toThrow(/non-ASCII word: cafés/);
  });

  it("produces identical feedback keys with cached and on-demand masks", () => {
    const targets = ["apple", "RATER", "civic", "fuzzy"];
    const guesses = ["allee", "array", "VIVID", "jazzy"];
    const masks = precomputeLetterMasks(targets);

    for (const target of targets) {
      for (const guess of guesses) {
        const uncached = feedbackKeyForWords(target, guess);
        const cached = feedbackKeyForWords(target, guess, masks.get(target));

        expect(cached, `${target}/${guess}`).toBe(uncached);
        expect(cached, `${target}/${guess}`).toBe(feedbackKey(scoreGuess(target, guess)));
      }
    }
  });
});
