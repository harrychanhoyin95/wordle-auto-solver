import { describe, expect, it } from "vitest";
import { scoreGuess } from "../src/feedback.js";
import { chooseInformativeCandidate } from "../src/solver.js";

function partitionSizes(candidates: readonly string[], guess: string): number[] {
  const buckets = new Map<string, number>();
  for (const candidate of candidates) {
    const pattern = scoreGuess(candidate, guess)
      .map(({ result }) => result[0])
      .join("");
    buckets.set(pattern, (buckets.get(pattern) ?? 0) + 1);
  }
  return [...buckets.values()].sort((left, right) => right - left);
}

describe("chooseInformativeCandidate production minimax behavior", () => {
  it("selects the guess with the smallest worst-case partition", () => {
    const candidates = ["apple", "ankle", "alert", "cater", "trace", "plane"];

    expect(partitionSizes(candidates, "sound")).toEqual([4, 1, 1]);
    expect(partitionSizes(candidates, "slate")).toEqual([2, 1, 1, 1, 1]);
    expect(chooseInformativeCandidate(candidates, new Set(), ["sound", "slate"])).toBe(
      "slate",
    );
  });

  it("uses the sum of squared partition sizes when worst-case sizes tie", () => {
    const candidates = ["apple", "ankle", "alert", "cater", "trace", "plane"];
    const broadPartitions = partitionSizes(candidates, "broad");
    const roundPartitions = partitionSizes(candidates, "round");

    expect(broadPartitions).toEqual([3, 2, 1]);
    expect(roundPartitions).toEqual([3, 1, 1, 1]);
    expect(broadPartitions.reduce((total, size) => total + size * size, 0)).toBe(14);
    expect(roundPartitions.reduce((total, size) => total + size * size, 0)).toBe(12);
    expect(chooseInformativeCandidate(candidates, new Set(), ["broad", "round"])).toBe(
      "round",
    );
  });

  it("prefers a remaining candidate when all partition metrics tie", () => {
    const candidates = ["raise", "cigar", "fuzzy"];

    expect(partitionSizes(candidates, "adieu")).toEqual([1, 1, 1]);
    expect(partitionSizes(candidates, "raise")).toEqual([1, 1, 1]);
    expect(chooseInformativeCandidate(candidates, new Set(), ["adieu", "raise"])).toBe(
      "raise",
    );
  });

  it("uses alphabetical order as the deterministic final tie-break", () => {
    const candidates = ["raise", "cigar", "fuzzy"];

    expect(partitionSizes(candidates, "adieu")).toEqual([1, 1, 1]);
    expect(partitionSizes(candidates, "crane")).toEqual([1, 1, 1]);
    expect(chooseInformativeCandidate(candidates, new Set(), ["crane", "adieu"])).toBe(
      "adieu",
    );
    expect(chooseInformativeCandidate(candidates, new Set(), ["adieu", "crane"])).toBe(
      "adieu",
    );
  });

  it("skips unusable guesses and handles direct-choice and exhausted states", () => {
    const candidates = ["raise", "cigar", "fuzzy"];

    expect(
      chooseInformativeCandidate(candidates, new Set(["adieu"]), [
        "pear",
        "adieu",
        "crane",
      ]),
    ).toBe("crane");
    expect(chooseInformativeCandidate(["cigar"], new Set(), [])).toBe("cigar");
    expect(() =>
      chooseInformativeCandidate(["cigar", "fuzzy"], new Set(), []),
    ).toThrow("There are no usable guesses left in the guess pool.");
    expect(() =>
      chooseInformativeCandidate(candidates, new Set(["adieu"]), ["pear", "adieu"]),
    ).toThrow("There are no usable guesses left in the guess pool.");
    expect(() => chooseInformativeCandidate(["cigar"], new Set(["cigar"]), [])).toThrow(
      "There are no untried candidates left.",
    );
  });
});
