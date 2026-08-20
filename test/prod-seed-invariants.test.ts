import { describe, expect, it, vi } from "vitest";
import { VoteeApiClient, type FetchLike } from "../src/api.js";
import { parseCliOptions } from "../src/cli-options.js";
import { scoreGuess } from "../src/feedback.js";
import { WordleSolver } from "../src/solver.js";
import type { GameTarget, GuessingApi } from "../src/types.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("production seed and target invariants", () => {
  it("reuses one random seed across solver guesses and every transient retry", async () => {
    const attemptsByGuess = new Map<string, number>();
    const fetchFn = vi.fn<FetchLike>(async (input) => {
      const url = new URL(String(input));
      const guess = url.searchParams.get("guess");
      if (guess === null) throw new Error("Missing guess in test request.");

      const attempt = (attemptsByGuess.get(guess) ?? 0) + 1;
      attemptsByGuess.set(guess, attempt);
      return attempt === 1
        ? jsonResponse({ detail: "temporary outage" }, 503)
        : jsonResponse(scoreGuess("apple", guess));
    });
    const solver = new WordleSolver(
      new VoteeApiClient({ fetchFn, retries: 1, retryDelayMs: 0 }),
      ["raise", "apple"],
    );

    const result = await solver.solve({ mode: "random", seed: 71_904, size: 5 });

    expect(result.answer).toBe("apple");
    expect(fetchFn).toHaveBeenCalledTimes(4);
    const urls = fetchFn.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls.map((url) => url.searchParams.get("guess"))).toEqual([
      "raise",
      "raise",
      "apple",
      "apple",
    ]);
    expect(urls.every((url) => url.searchParams.get("seed") === "71904")).toBe(true);
    expect(urls.every((url) => url.searchParams.get("size") === "5")).toBe(true);
  });

  it("serializes distinct random targets with distinct seed query parameters", async () => {
    const fetchFn = vi.fn<FetchLike>(async (input) => {
      const guess = new URL(String(input)).searchParams.get("guess");
      if (guess === null) throw new Error("Missing guess in test request.");
      return jsonResponse(scoreGuess("apple", guess));
    });
    const client = new VoteeApiClient({ fetchFn, retries: 0 });

    await client.guess({ mode: "random", seed: 12_345, size: 5 }, "raise");
    await client.guess({ mode: "random", seed: 54_321, size: 5 }, "raise");

    const urls = fetchFn.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls.map((url) => url.searchParams.get("seed"))).toEqual(["12345", "54321"]);
    expect(urls[0]?.href).not.toBe(urls[1]?.href);
  });

  it("preserves zero, negative, and boundary safe-integer seeds from CLI to request URL", async () => {
    const seeds = [0, -1, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    const fetchFn = vi.fn<FetchLike>(async (input) => {
      const guess = new URL(String(input)).searchParams.get("guess");
      if (guess === null) throw new Error("Missing guess in test request.");
      return jsonResponse(scoreGuess("apple", guess));
    });
    const client = new VoteeApiClient({ fetchFn, retries: 0 });
    const createSeed = vi.fn(() => 999);

    for (const seed of seeds) {
      const parsed = parseCliOptions(["random", "--seed", String(seed)], createSeed);
      expect(parsed.kind).toBe("run");
      if (parsed.kind !== "run") throw new Error("Expected run options.");
      expect(parsed.options.target).toEqual({ mode: "random", size: 5, seed });
      await client.guess(parsed.options.target, "raise");
    }

    expect(createSeed).not.toHaveBeenCalled();
    const serializedSeeds = fetchFn.mock.calls.map(([input]) =>
      new URL(String(input)).searchParams.get("seed"),
    );
    expect(serializedSeeds).toEqual(seeds.map(String));
  });

  it("never leaks an extraneous seed property into daily or selected-word URLs", async () => {
    const fetchFn = vi.fn<FetchLike>(async (input) => {
      const guess = new URL(String(input)).searchParams.get("guess");
      if (guess === null) throw new Error("Missing guess in test request.");
      return jsonResponse(scoreGuess("apple", guess));
    });
    const client = new VoteeApiClient({ fetchFn, retries: 0 });
    const pollutedDaily = Object.freeze({ mode: "daily" as const, size: 5, seed: 777 });
    const pollutedWord = Object.freeze({ mode: "word" as const, word: "APPLE", seed: 888 });

    await client.guess(pollutedDaily, "raise");
    await client.guess(pollutedWord, "raise");

    const [dailyUrl, wordUrl] = fetchFn.mock.calls.map(([input]) => new URL(String(input)));
    expect(dailyUrl?.pathname).toBe("/daily");
    expect([...dailyUrl!.searchParams]).toEqual([
      ["guess", "raise"],
      ["size", "5"],
    ]);
    expect(wordUrl?.pathname).toBe("/word/apple");
    expect([...wordUrl!.searchParams]).toEqual([["guess", "raise"]]);
  });

  it("keeps frozen caller inputs unchanged and solver state isolated between runs", async () => {
    const seenTargets: GameTarget[] = [];
    const api: GuessingApi = {
      guess: vi.fn(async (target, guess) => {
        seenTargets.push(target);
        return scoreGuess("apple", guess);
      }),
    };
    const candidates = Object.freeze(["RAISE", "APPLE"]);
    const guesses = Object.freeze(["RAISE", "APPLE"]);
    const target = Object.freeze({ mode: "random" as const, seed: -42, size: 5 });
    const onProgress = vi.fn();
    const options = Object.freeze({ firstGuess: "RAISE", maxAttempts: 6, onProgress });
    const solver = new WordleSolver(api, candidates, guesses);

    const first = await solver.solve(target, options);
    const second = await solver.solve(target, options);

    expect(first.history.map(({ guess }) => guess)).toEqual(["raise", "apple"]);
    expect(second.history.map(({ guess }) => guess)).toEqual(["raise", "apple"]);
    expect(seenTargets).toHaveLength(4);
    expect(seenTargets.every((seen) => seen === target)).toBe(true);
    expect(target).toEqual({ mode: "random", seed: -42, size: 5 });
    expect(candidates).toEqual(["RAISE", "APPLE"]);
    expect(guesses).toEqual(["RAISE", "APPLE"]);
    expect(options).toEqual({ firstGuess: "RAISE", maxAttempts: 6, onProgress });
    expect(onProgress).toHaveBeenCalledTimes(4);
  });
});
