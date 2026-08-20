import { describe, expect, it } from "vitest";
import { scoreGuess } from "../src/feedback.js";
import { SolverError, WordleSolver, chooseInformativeCandidate } from "../src/solver.js";
import type { GameTarget, GuessingApi } from "../src/types.js";
import { loadAnswerList, loadWordList } from "../src/word-list.js";

class LocalOracle implements GuessingApi {
  readonly guesses: string[] = [];

  constructor(private readonly answer: string) {}

  async guess(_target: GameTarget, guess: string) {
    this.guesses.push(guess);
    return scoreGuess(this.answer, guess);
  }
}

describe("WordleSolver", () => {
  it.each(["wrote", "apple", "cigar", "fuzzy"])("solves %s", async (answer) => {
    const words = ["raise", "wrote", "apple", "cigar", "fuzzy", "route", "crone", "stare"];
    const solver = new WordleSolver(new LocalOracle(answer), words);

    const result = await solver.solve({ mode: "random", seed: 42, size: 5 });

    expect(result.answer).toBe(answer);
    expect(result.attempts).toBeLessThanOrEqual(5);
    expect(result.history).toHaveLength(result.attempts);
  });

  it("supports a custom first guess", async () => {
    const solver = new WordleSolver(new LocalOracle("apple"), ["raise", "apple", "allee"]);
    const result = await solver.solve(
      { mode: "word", word: "apple" },
      { firstGuess: "allee" },
    );

    expect(result.history[0]?.guess).toBe("allee");
    expect(result.answer).toBe("apple");
  });

  it("rejects a fabricated custom first guess before any API request", async () => {
    const oracle = new LocalOracle("apple");
    const solver = new WordleSolver(oracle, ["raise", "apple", "allee"]);

    await expect(
      solver.solve({ mode: "word", word: "apple" }, { firstGuess: "zzzzz" }),
    ).rejects.toThrow(/valid-word list/);
    expect(oracle.guesses).toEqual([]);
  });

  it("submits only words from the configured valid-word list", async () => {
    const words = ["raise", "apple", "allee", "ample", "plomb", "leant"];
    const allowed = new Set(words);
    const oracle = new LocalOracle("apple");
    const solver = new WordleSolver(oracle, words);

    await solver.solve({ mode: "word", word: "apple" }, { maxAttempts: 6 });

    expect(oracle.guesses.length).toBeGreaterThan(0);
    expect(oracle.guesses.every((guess) => allowed.has(guess))).toBe(true);
  });

  it("solves APPLE within six attempts with separate answer and guess pools", async () => {
    const answers = await loadAnswerList({ size: 5 });
    const guesses = await loadWordList({ size: 5 });
    const solver = new WordleSolver(new LocalOracle("apple"), answers, guesses);

    const result = await solver.solve(
      { mode: "word", word: "apple" },
      { maxAttempts: 6 },
    );

    expect(result.answer).toBe("apple");
    expect(result.attempts).toBeLessThanOrEqual(6);
  });

  it("can isolate a dictionary-backed API answer outside the valid-guess pool", async () => {
    const answers = ["janet", "taken", "rater"];
    const guesses = ["raise", "dwalm", "cyton"];
    const oracle = new LocalOracle("janet");
    const solver = new WordleSolver(oracle, answers, guesses);

    const result = await solver.solve(
      { mode: "random", seed: 2_015_760_431, size: 5 },
      { maxAttempts: 6 },
    );

    expect(result.answer).toBe("janet");
    expect(oracle.guesses.slice(0, -1).every((guess) => guesses.includes(guess))).toBe(true);
  });

  it("fails clearly when the answer is absent from the candidate list", async () => {
    const solver = new WordleSolver(new LocalOracle("wrote"), ["raise", "apple", "cigar"]);

    await expect(solver.solve({ mode: "word", word: "wrote" })).rejects.toThrow(SolverError);
  });

  it("enforces the attempt limit", async () => {
    const solver = new WordleSolver(new LocalOracle("apple"), ["raise", "apple"]);

    await expect(
      solver.solve({ mode: "word", word: "apple" }, { maxAttempts: 1 }),
    ).rejects.toThrow(/within 1 attempt/);
  });
});

describe("chooseInformativeCandidate", () => {
  it("is deterministic and avoids attempted words", () => {
    const candidates = ["crate", "trace", "react", "cater"];
    const first = chooseInformativeCandidate(candidates, new Set());
    const second = chooseInformativeCandidate(candidates, new Set([first]));

    expect(chooseInformativeCandidate(candidates, new Set())).toBe(first);
    expect(second).not.toBe(first);
  });

});
