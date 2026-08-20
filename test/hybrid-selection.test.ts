import { describe, expect, it, vi } from "vitest";
import { precomputeLetterMasks, scoreGuess } from "../src/feedback.js";
import {
  WordleSolver,
  buildFrequencyShortlist,
  chooseHybridCandidate,
  chooseInformativeCandidate,
} from "../src/solver.js";
import type { GameTarget, GuessingApi } from "../src/types.js";

describe("production hybrid selector", () => {
  it("uses exact full-pool minimax once the candidate set reaches the final threshold", () => {
    const candidates = ["apple", "ankle", "alert", "cater", "trace", "plane"];
    const guesses = ["sound", "slate", "broad", "round"];
    const masks = precomputeLetterMasks([...candidates, ...guesses]);

    expect(chooseHybridCandidate(candidates, new Set(), guesses, masks)).toBe(
      chooseInformativeCandidate(candidates, new Set(), guesses, masks),
    );
  });

  it("builds a deterministic adaptive shortlist and excludes unusable guesses", () => {
    const candidates = words(0, 101);
    const attemptedGuess = wordAt(10_000);
    const guessPool = [attemptedGuess, ...words(10_001, 600), "toolong"];
    const masks = precomputeLetterMasks([...candidates, ...guessPool]);
    const options = {
      partitionBudget: 101,
      fullScanThreshold: 100,
      minimumShortlistSize: 8,
    } as const;

    const first = buildFrequencyShortlist(
      candidates,
      new Set([attemptedGuess]),
      guessPool,
      masks,
      options,
    );
    const second = buildFrequencyShortlist(
      candidates,
      new Set([attemptedGuess]),
      guessPool,
      masks,
      options,
    );

    expect(first).toEqual(second);
    expect(first).toHaveLength(8);
    expect(first).not.toContain(attemptedGuess);
    expect(first).not.toContain("toolong");
  });

  it("always retains untried candidates that are also valid guesses", () => {
    const candidates = words(0, 101);
    const validCandidate = candidates[50] as string;
    const guessPool = [...words(10_000, 600), validCandidate];
    const masks = precomputeLetterMasks([...candidates, ...guessPool]);

    const shortlist = buildFrequencyShortlist(
      candidates,
      new Set(),
      guessPool,
      masks,
      { partitionBudget: 101, fullScanThreshold: 100, minimumShortlistSize: 8 },
    );

    expect(shortlist).toContain(validCandidate);
    expect(shortlist.length).toBeGreaterThanOrEqual(8);
    expect(shortlist.length).toBeLessThanOrEqual(9);
  });

  it("routes the production solve loop through the hybrid selector", async () => {
    const candidates = words(0, 150);
    const answer = candidates[0] as string;
    const guessPool = ["zzzzz", ...words(10_000, 700)];
    const masks = precomputeLetterMasks([...candidates, ...guessPool]);
    const expectedSecondGuess = chooseHybridCandidate(
      candidates,
      new Set(["zzzzz"]),
      guessPool,
      masks,
      { partitionBudget: 150 },
    );
    const submitted: string[] = [];
    const api: GuessingApi = {
      guess: vi.fn(async (_target: GameTarget, guess: string) => {
        submitted.push(guess);
        return scoreGuess(answer, guess);
      }),
    };
    const solver = new WordleSolver(api, candidates, guessPool);

    await expect(
      solver.solve(
        { mode: "word", word: answer },
        { firstGuess: "zzzzz", maxAttempts: 2, partitionBudget: 150 },
      ),
    ).rejects.toThrow("within 2 attempts");
    expect(submitted).toEqual(["zzzzz", expectedSecondGuess]);
  });

  it("rejects invalid hybrid budgets before making an API request", async () => {
    const guess = vi.fn(async () => scoreGuess("apple", "raise"));
    const solver = new WordleSolver({ guess }, ["apple", "ample"], ["raise", "apple"]);

    for (const partitionBudget of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        solver.solve({ mode: "word", word: "apple" }, { partitionBudget }),
      ).rejects.toThrow("partitionBudget must be a positive integer");
    }
    expect(guess).not.toHaveBeenCalled();
  });
});

function words(start: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) => wordAt(start + index));
}

function wordAt(value: number): string {
  let remaining = value;
  let word = "";
  for (let slot = 0; slot < 5; slot += 1) {
    word += String.fromCharCode(97 + (remaining % 26));
    remaining = Math.floor(remaining / 26);
  }
  return word;
}
