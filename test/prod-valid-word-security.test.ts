import { describe, expect, it, vi } from "vitest";
import { scoreGuess } from "../src/feedback.js";
import { WordleSolver } from "../src/solver.js";
import type { GameTarget, GuessingApi } from "../src/types.js";

function createOracle(answer: string): {
  readonly api: GuessingApi;
  readonly guess: ReturnType<typeof vi.fn>;
} {
  const guess = vi.fn(async (_target: GameTarget, word: string) => scoreGuess(answer, word));
  return { api: { guess }, guess };
}

describe("production valid-word and guess-boundary security", () => {
  it("rejects arbitrary, non-ASCII, wrong-length, and unconfigured first guesses before I/O", async () => {
    const invalidFirstGuesses = ["<script>", "naïve", "four", "zzzzz"];

    for (const firstGuess of invalidFirstGuesses) {
      const oracle = createOracle("apple");
      const solver = new WordleSolver(oracle.api, ["apple", "ample"], ["raise", "crate"]);

      await expect(
        solver.solve({ mode: "word", word: "apple" }, { firstGuess }),
      ).rejects.toThrow(/ASCII letters|configured valid-word list/);
      expect(oracle.guess, firstGuess).not.toHaveBeenCalled();
    }
  });

  it("accepts a configured first guess case-insensitively and sends its normalized form", async () => {
    const oracle = createOracle("apple");
    const solver = new WordleSolver(
      oracle.api,
      ["apple", "ample"],
      ["crate", "apple", "ample"],
    );

    const result = await solver.solve(
      { mode: "word", word: "apple" },
      { firstGuess: "CrAtE", maxAttempts: 4 },
    );

    expect(result.answer).toBe("apple");
    expect(oracle.guess.mock.calls[0]?.[1]).toBe("crate");
    expect(oracle.guess.mock.calls.every(([, guess]) => guess === guess.toLowerCase())).toBe(true);
  });

  it("keeps every automatic exploratory guess inside the narrow valid-guess pool", async () => {
    const answerWords = ["janet", "taken", "rater", "rated", "water"];
    const validGuessWords = ["raise", "dwalm", "cyton"];
    const oracle = createOracle("janet");
    const solver = new WordleSolver(oracle.api, answerWords, validGuessWords);

    const result = await solver.solve(
      { mode: "random", seed: 2_015_760_431, size: 5 },
      { maxAttempts: 6 },
    );
    const exploratoryGuesses = result.history.filter(({ candidatesBefore }) => candidatesBefore > 1);

    expect(exploratoryGuesses.length).toBeGreaterThan(0);
    expect(
      exploratoryGuesses.every(({ guess }) => validGuessWords.includes(guess)),
    ).toBe(true);
  });

  it("submits a broader dictionary-backed answer only after it is the isolated final candidate", async () => {
    const answerWords = ["janet", "taken", "rater", "rated", "water"];
    const validGuessWords = ["raise", "dwalm", "cyton"];
    const oracle = createOracle("janet");
    const solver = new WordleSolver(oracle.api, answerWords, validGuessWords);

    const result = await solver.solve(
      { mode: "random", seed: 2_015_760_431, size: 5 },
      { maxAttempts: 6 },
    );
    const broaderSubmissions = result.history.filter(
      ({ guess }) => answerWords.includes(guess) && !validGuessWords.includes(guess),
    );

    expect(broaderSubmissions).toHaveLength(1);
    expect(broaderSubmissions[0]).toMatchObject({
      guess: "janet",
      candidatesBefore: 1,
      candidatesAfter: 1,
    });
    expect(result.history.at(-1)).toBe(broaderSubmissions[0]);
  });

  it("never submits the same guess twice during a multi-attempt solve", async () => {
    const oracle = createOracle("janet");
    const solver = new WordleSolver(
      oracle.api,
      ["janet", "taken", "rater", "rated", "water"],
      ["raise", "dwalm", "cyton"],
    );

    const result = await solver.solve(
      { mode: "random", seed: 2_015_760_431, size: 5 },
      { maxAttempts: 6 },
    );
    const submitted = oracle.guess.mock.calls.map(([, guess]) => guess);

    expect(result.attempts).toBeGreaterThan(1);
    expect(new Set(submitted).size).toBe(submitted.length);
    expect(submitted).toEqual(result.history.map(({ guess }) => guess));
  });
});
