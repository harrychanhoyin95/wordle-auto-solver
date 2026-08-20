import { describe, expect, it } from "vitest";
import { VoteeApiClient } from "../src/api.js";
import { WordleSolver } from "../src/solver.js";
import { loadAnswerList, loadWordList } from "../src/word-list.js";

const live = process.env.LIVE_API === "1" ? describe : describe.skip;

live("live Votee API", () => {
  it("matches the documented duplicate-letter behavior", async () => {
    const client = new VoteeApiClient({ retries: 0 });
    const feedback = await client.guess({ mode: "word", word: "apple" }, "allee");

    expect(feedback.map(({ result }) => result)).toEqual([
      "correct",
      "present",
      "present",
      "present",
      "correct",
    ]);
  });

  it("solves the stable seed-42 random puzzle", async () => {
    const [answers, guesses] = await Promise.all([
      loadAnswerList({ size: 5 }),
      loadWordList({ size: 5 }),
    ]);
    const solver = new WordleSolver(new VoteeApiClient({ retries: 1 }), answers, guesses);
    const result = await solver.solve(
      { mode: "random", size: 5, seed: 42 },
      { maxAttempts: 12 },
    );

    expect(result.answer).toBe("wrote");
  }, 30_000);

  it("solves seed 2015760431, whose JANET answer is outside the classic Wordle list", async () => {
    const [answers, guesses] = await Promise.all([
      loadAnswerList({ size: 5 }),
      loadWordList({ size: 5 }),
    ]);
    const solver = new WordleSolver(new VoteeApiClient({ retries: 1 }), answers, guesses);
    const result = await solver.solve(
      { mode: "random", size: 5, seed: 2_015_760_431 },
      { maxAttempts: 6 },
    );

    expect(result.answer).toBe("janet");
    expect(result.attempts).toBeLessThanOrEqual(6);
  }, 30_000);
});
