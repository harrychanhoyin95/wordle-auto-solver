import { describe, expect, it, vi } from "vitest";
import { VoteeApiClient, type FetchLike } from "../src/api.js";
import { scoreGuess } from "../src/feedback.js";
import { SolverError, WordleSolver, type SolverProgress } from "../src/solver.js";
import type { GameTarget, GuessingApi } from "../src/types.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

class RecordingOracle implements GuessingApi {
  readonly guesses: string[] = [];

  constructor(private readonly answer: string) {}

  async guess(_target: GameTarget, guess: string) {
    this.guesses.push(guess);
    return scoreGuess(this.answer, guess);
  }
}

describe("production failure paths", () => {
  it("reports candidate exhaustion with actionable context and the terminal progress snapshot", async () => {
    const oracle = new RecordingOracle("wrote");
    const solver = new WordleSolver(oracle, ["apple"], ["raise"]);
    const progress: SolverProgress[] = [];

    await expect(
      solver.solve(
        { mode: "random", seed: 99, size: 5 },
        { onProgress: (entry) => progress.push(entry) },
      ),
    ).rejects.toEqual(
      new SolverError(
        "No candidate matches the API feedback. Supply a word list containing the answer.",
      ),
    );

    expect(oracle.guesses).toEqual(["raise"]);
    expect(progress).toMatchObject([
      { attempt: 1, guess: "raise", candidatesBefore: 1, candidatesAfter: 0 },
    ]);
  });

  it("rejects an empty valid-guess pool and invalid attempt limits before API I/O", async () => {
    const guess = vi.fn<GuessingApi["guess"]>();
    const api: GuessingApi = { guess };
    const target = { mode: "word", word: "apple" } as const;

    await expect(new WordleSolver(api, ["apple"], []).solve(target)).rejects.toThrow(
      "The valid-guess list has no 5-letter words.",
    );

    for (const maxAttempts of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const solver = new WordleSolver(api, ["apple"], ["raise"]);
      await expect(solver.solve(target, { maxAttempts })).rejects.toThrow(
        "maxAttempts must be a positive integer.",
      );
    }

    expect(guess).not.toHaveBeenCalled();
  });

  it("rejects empty and malformed feedback payloads before the solver can consume them", async () => {
    const target = { mode: "word", word: "apple" } as const;
    const payloads: ReadonlyArray<{ readonly value: unknown; readonly error: string }> = [
      { value: [], error: "Invalid API response: expected 5 result items." },
      {
        value: scoreGuess("apple", "raise").map((item, index) =>
          index === 2 ? { ...item, result: "unknown" } : item,
        ),
        error: "Invalid API response: unknown result kind.",
      },
    ];

    for (const payload of payloads) {
      const fetchFn = vi.fn<FetchLike>(async () => jsonResponse(payload.value));
      const client = new VoteeApiClient({ fetchFn, retries: 0 });

      await expect(client.guess(target, "raise")).rejects.toThrow(payload.error);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });

  it("propagates an API failure and starts a later solve with clean candidate and attempt state", async () => {
    const networkFailure = new Error("connection reset by peer");
    const guess = vi
      .fn<GuessingApi["guess"]>()
      .mockResolvedValueOnce(scoreGuess("apple", "raise"))
      .mockRejectedValueOnce(networkFailure);
    const solver = new WordleSolver({ guess }, ["apple", "ample"], ["raise", "apple"]);
    const failedRunProgress: SolverProgress[] = [];

    await expect(
      solver.solve(
        { mode: "word", word: "apple" },
        { onProgress: (entry) => failedRunProgress.push(entry) },
      ),
    ).rejects.toBe(networkFailure);
    expect(failedRunProgress).toMatchObject([
      { attempt: 1, guess: "raise", candidatesBefore: 2, candidatesAfter: 2 },
    ]);

    guess.mockReset();
    guess.mockImplementation(async (_target, submittedGuess) =>
      scoreGuess("apple", submittedGuess),
    );
    const recoveredProgress: SolverProgress[] = [];
    const result = await solver.solve(
      { mode: "word", word: "apple" },
      { onProgress: (entry) => recoveredProgress.push(entry) },
    );

    expect(result.answer).toBe("apple");
    expect(result.attempts).toBe(2);
    expect(recoveredProgress[0]).toMatchObject({
      attempt: 1,
      guess: "raise",
      candidatesBefore: 2,
    });
    expect(guess.mock.calls.map(([, submittedGuess]) => submittedGuess)).toEqual([
      "raise",
      "apple",
    ]);
  });

  it("keeps callback progress, returned history, and request count consistent at the cutoff", async () => {
    const oracle = new RecordingOracle("ample");
    const solver = new WordleSolver(
      oracle,
      ["apple", "ample"],
      ["raise", "apple", "ample"],
    );
    const progress: SolverProgress[] = [];

    const result = await solver.solve(
      { mode: "word", word: "ample" },
      { maxAttempts: 2, onProgress: (entry) => progress.push(entry) },
    );

    expect(result).toMatchObject({ answer: "ample", attempts: 2 });
    expect(oracle.guesses).toEqual(["raise", "ample"]);
    expect(result.history).toEqual(progress);
    expect(progress).toMatchObject([
      { attempt: 1, guess: "raise", candidatesBefore: 2, candidatesAfter: 2 },
      { attempt: 2, guess: "ample", candidatesBefore: 2, candidatesAfter: 1 },
    ]);
  });
});
