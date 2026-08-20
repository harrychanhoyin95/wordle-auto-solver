import { describe, expect, it } from "vitest";
import { scoreGuess } from "../src/feedback.js";
import { SolverError, WordleSolver } from "../src/solver.js";
import type { GameTarget, GuessingApi } from "../src/types.js";
import { loadAnswerList, loadWordList } from "../src/word-list.js";

class RecordingOracle implements GuessingApi {
  readonly guesses: string[] = [];

  constructor(private readonly answer: string) {}

  async guess(_target: GameTarget, guess: string) {
    this.guesses.push(guess);
    return scoreGuess(this.answer, guess);
  }
}

describe("production solver answer and guess pools", () => {
  it("keeps 20,148 bundled answers separate from 14,855 valid exploratory guesses", async () => {
    const [answers, guesses] = await Promise.all([
      loadAnswerList({ size: 5 }),
      loadWordList({ size: 5 }),
    ]);

    expect(answers).toHaveLength(20_148);
    expect(guesses).toHaveLength(14_855);
    expect(answers).toContain("janet");
    expect(guesses).not.toContain("janet");
  });

  it("solves broader-only JANET while keeping every exploratory probe in the narrow pool", async () => {
    const answers = ["janet", "taken", "rater", "rated", "water"];
    const validGuesses = ["raise", "dwalm", "cyton"];
    const validGuessSet = new Set(validGuesses);
    const oracle = new RecordingOracle("janet");
    const solver = new WordleSolver(oracle, answers, validGuesses);

    const result = await solver.solve(
      { mode: "random", seed: 2_015_760_431, size: 5 },
      { maxAttempts: 6 },
    );

    expect(result.answer).toBe("janet");
    expect(result.attempts).toBeLessThanOrEqual(6);
    expect(oracle.guesses.at(-1)).toBe("janet");
    expect(oracle.guesses.slice(0, -1).every((guess) => validGuessSet.has(guess))).toBe(true);
  });

  it("reports candidate exhaustion immediately when the local answer pool cannot match feedback", async () => {
    const oracle = new RecordingOracle("wrote");
    const solver = new WordleSolver(oracle, ["apple"], ["raise"]);

    await expect(
      solver.solve({ mode: "random", seed: 99, size: 5 }),
    ).rejects.toThrow(
      new SolverError(
        "No candidate matches the API feedback. Supply a word list containing the answer.",
      ),
    );
    expect(oracle.guesses).toEqual(["raise"]);
  });

  it("accepts only configured custom first guesses and rejects unknown words before I/O", async () => {
    const acceptedOracle = new RecordingOracle("apple");
    const acceptedSolver = new WordleSolver(
      acceptedOracle,
      ["apple", "ample"],
      ["raise", "crate", "apple", "ample"],
    );

    const accepted = await acceptedSolver.solve(
      { mode: "word", word: "apple" },
      { firstGuess: "CRATE", maxAttempts: 3 },
    );
    expect(accepted.history[0]?.guess).toBe("crate");

    const rejectedOracle = new RecordingOracle("apple");
    const rejectedSolver = new WordleSolver(
      rejectedOracle,
      ["apple", "ample"],
      ["raise", "crate", "apple", "ample"],
    );
    await expect(
      rejectedSolver.solve(
        { mode: "word", word: "apple" },
        { firstGuess: "zzzzz", maxAttempts: 3 },
      ),
    ).rejects.toThrow(/not present in the configured valid-word list/);
    expect(rejectedOracle.guesses).toEqual([]);
  });

  it("stops exactly at maxAttempts without issuing a speculative extra request", async () => {
    const oracle = new RecordingOracle("apple");
    const solver = new WordleSolver(oracle, ["apple", "ample"], ["raise"]);
    const progress: number[] = [];

    await expect(
      solver.solve(
        { mode: "word", word: "apple" },
        {
          maxAttempts: 1,
          onProgress: ({ attempt }) => progress.push(attempt),
        },
      ),
    ).rejects.toThrow("Could not solve the puzzle within 1 attempts.");
    expect(oracle.guesses).toEqual(["raise"]);
    expect(progress).toEqual([1]);
  });
});
