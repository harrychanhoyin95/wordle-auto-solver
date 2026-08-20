import { describe, expect, it, vi } from "vitest";
import { VoteeApiClient, type FetchLike } from "../src/api.js";
import { scoreGuess } from "../src/feedback.js";
import { WordleSolver, type SolveResult } from "../src/solver.js";
import { loadAnswerList, loadWordList } from "../src/word-list.js";

interface MockVoteeOptions {
  readonly randomAnswers?: ReadonlyMap<number, string>;
  readonly dailyAnswer?: string;
  readonly allowedGuesses: ReadonlySet<string>;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function createMockVotee(options: MockVoteeOptions): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const guess = url.searchParams.get("guess");

    if (guess === null) {
      return new Response("missing guess", { status: 422 });
    }
    if (!options.allowedGuesses.has(guess)) {
      return new Response("guess is not in the test dictionary", { status: 422 });
    }
    if (init?.signal?.aborted) {
      throw new DOMException("Request aborted", "AbortError");
    }

    let answer: string | undefined;
    if (url.pathname === "/random") {
      const seed = Number(url.searchParams.get("seed"));
      answer = options.randomAnswers?.get(seed);
      if (url.searchParams.get("size") !== String(answer?.length ?? "")) {
        return new Response("invalid size", { status: 422 });
      }
    } else if (url.pathname === "/daily") {
      answer = options.dailyAnswer;
      if (url.searchParams.get("size") !== String(answer?.length ?? "")) {
        return new Response("invalid size", { status: 422 });
      }
    } else if (url.pathname.startsWith("/word/")) {
      answer = decodeURIComponent(url.pathname.slice("/word/".length)).toLowerCase();
      if (url.searchParams.has("size") || url.searchParams.has("seed")) {
        return new Response("word mode must not send size or seed", { status: 422 });
      }
    }

    if (answer === undefined) {
      return new Response("unknown test target", { status: 404 });
    }
    return jsonResponse(scoreGuess(answer, guess));
  });
}

function requestUrls(fetchFn: ReturnType<typeof vi.fn<FetchLike>>): URL[] {
  return fetchFn.mock.calls.map(([input]) =>
    new URL(input instanceof Request ? input.url : String(input)),
  );
}

function assertConsistentResult(result: SolveResult, submittedGuesses: readonly string[]): void {
  expect(result.attempts).toBe(result.history.length);
  expect(result.history.map(({ attempt }) => attempt)).toEqual(
    Array.from({ length: result.attempts }, (_, index) => index + 1),
  );
  expect(result.history.map(({ guess }) => guess).join(",")).toBe(submittedGuesses.join(","));
  expect(result.history.at(-1)?.guess).toBe(result.answer);
  expect(result.history.at(-1)?.feedback.every(({ result: kind }) => kind === "correct")).toBe(
    true,
  );
  expect(result.history.every(({ candidatesAfter }) => candidatesAfter >= 1)).toBe(true);
}

describe("production offline API-to-solver journeys", () => {
  it("keeps seed 42 stable on every random request and solves WROTE within six guesses", async () => {
    const [answers, guesses] = await Promise.all([
      loadAnswerList({ size: 5 }),
      loadWordList({ size: 5 }),
    ]);
    const allowedGuesses = new Set([...answers, ...guesses]);
    const fetchFn = createMockVotee({
      randomAnswers: new Map([[42, "wrote"]]),
      allowedGuesses,
    });
    const solver = new WordleSolver(
      new VoteeApiClient({ baseUrl: "https://offline.votee.test:8000", fetchFn, retries: 0 }),
      answers,
      guesses,
    );

    const result = await solver.solve(
      { mode: "random", seed: 42, size: 5 },
      { maxAttempts: 6 },
    );
    const urls = requestUrls(fetchFn);
    const submitted = urls.map((url) => url.searchParams.get("guess") ?? "");

    expect(result.answer).toBe("wrote");
    expect(result.attempts).toBeLessThanOrEqual(6);
    expect(urls.every((url) => url.pathname === "/random")).toBe(true);
    expect(urls.every((url) => url.searchParams.get("seed") === "42")).toBe(true);
    expect(urls.every((url) => url.searchParams.get("size") === "5")).toBe(true);
    expect(submitted.every((guess) => guesses.includes(guess))).toBe(true);
    assertConsistentResult(result, submitted);
  });

  it("solves broader JANET while restricting every earlier probe to the valid-guess pool", async () => {
    const [bundledAnswers, bundledGuesses] = await Promise.all([
      loadAnswerList({ size: 5 }),
      loadWordList({ size: 5 }),
    ]);
    expect(bundledAnswers).toContain("janet");
    expect(bundledGuesses).not.toContain("janet");

    const answers = ["janet", "taken", "rater", "rated", "water"];
    const guesses = ["raise", "dwalm", "cyton"];
    const allowedGuesses = new Set([...answers, ...guesses]);
    const seed = 2_015_760_431;
    const fetchFn = createMockVotee({
      randomAnswers: new Map([[seed, "janet"]]),
      allowedGuesses,
    });
    const solver = new WordleSolver(new VoteeApiClient({ fetchFn, retries: 0 }), answers, guesses);

    const result = await solver.solve(
      { mode: "random", seed, size: 5 },
      { maxAttempts: 6 },
    );
    const urls = requestUrls(fetchFn);
    const submitted = urls.map((url) => url.searchParams.get("guess") ?? "");

    expect(result.answer).toBe("janet");
    expect(result.attempts).toBeLessThanOrEqual(6);
    expect(submitted.at(-1)).toBe("janet");
    expect(submitted.slice(0, -1).every((guess) => guesses.includes(guess))).toBe(true);
    expect(submitted.filter((guess) => guess === "janet")).toHaveLength(1);
    expect(urls.every((url) => url.searchParams.get("seed") === String(seed))).toBe(true);
    assertConsistentResult(result, submitted);
  });

  it("routes a daily puzzle without a seed and preserves history/request consistency", async () => {
    const candidates = ["cigar", "rebut", "sissy", "humph", "awake"];
    const guesses = ["raise", "crate", "cigar", "rebut", "sissy", "humph", "awake"];
    const allowedGuesses = new Set([...candidates, ...guesses]);
    const fetchFn = createMockVotee({ dailyAnswer: "cigar", allowedGuesses });
    const solver = new WordleSolver(
      new VoteeApiClient({ baseUrl: "https://offline.votee.test/api", fetchFn, retries: 0 }),
      candidates,
      guesses,
    );

    const result = await solver.solve(
      { mode: "daily", size: 5 },
      { maxAttempts: 6 },
    );
    const urls = requestUrls(fetchFn);
    const submitted = urls.map((url) => url.searchParams.get("guess") ?? "");

    expect(result.answer).toBe("cigar");
    expect(result.attempts).toBeLessThanOrEqual(6);
    expect(urls.every((url) => url.pathname === "/daily")).toBe(true);
    expect(urls.every((url) => url.searchParams.get("size") === "5")).toBe(true);
    expect(urls.every((url) => !url.searchParams.has("seed"))).toBe(true);
    expect(submitted.every((guess) => guesses.includes(guess))).toBe(true);
    assertConsistentResult(result, submitted);
  });

  it("uses selected-word routing and Votee's non-consuming duplicate-letter semantics", async () => {
    const candidates = ["apple", "ample", "angle"];
    const guesses = ["allee", "raise", "apple", "ample", "angle"];
    const allowedGuesses = new Set([...candidates, ...guesses]);
    const fetchFn = createMockVotee({ allowedGuesses });
    const solver = new WordleSolver(new VoteeApiClient({ fetchFn, retries: 0 }), candidates, guesses);

    const result = await solver.solve(
      { mode: "word", word: "apple" },
      { firstGuess: "allee", maxAttempts: 6 },
    );
    const urls = requestUrls(fetchFn);
    const submitted = urls.map((url) => url.searchParams.get("guess") ?? "");

    expect(result.answer).toBe("apple");
    expect(result.attempts).toBeLessThanOrEqual(6);
    expect(result.history[0]?.feedback.map(({ result: kind }) => kind)).toEqual([
      "correct",
      "present",
      "present",
      "present",
      "correct",
    ]);
    expect(urls.every((url) => url.pathname === "/word/apple")).toBe(true);
    expect(urls.every((url) => !url.searchParams.has("size") && !url.searchParams.has("seed"))).toBe(
      true,
    );
    expect(submitted.every((guess) => allowedGuesses.has(guess))).toBe(true);
    assertConsistentResult(result, submitted);
  });

  it("isolates mutable solve state across sequential targets using one custom-pooled solver", async () => {
    const candidates = ["wrote", "apple", "route", "ample"];
    const guesses = ["raise", "allee", "crate", "wrote", "apple", "route", "ample"];
    const allowedGuesses = new Set([...candidates, ...guesses]);
    const fetchFn = createMockVotee({ allowedGuesses });
    const solver = new WordleSolver(new VoteeApiClient({ fetchFn, retries: 0 }), candidates, guesses);

    const first = await solver.solve(
      { mode: "word", word: "wrote" },
      { firstGuess: "raise", maxAttempts: 6 },
    );
    const firstRequestCount = fetchFn.mock.calls.length;
    const second = await solver.solve(
      { mode: "word", word: "apple" },
      { firstGuess: "raise", maxAttempts: 6 },
    );
    const [firstUrls, secondUrls] = [
      requestUrls(fetchFn).slice(0, firstRequestCount),
      requestUrls(fetchFn).slice(firstRequestCount),
    ];
    const firstSubmitted = firstUrls.map((url) => url.searchParams.get("guess") ?? "");
    const secondSubmitted = secondUrls.map((url) => url.searchParams.get("guess") ?? "");

    expect(first.answer).toBe("wrote");
    expect(second.answer).toBe("apple");
    expect(first.attempts).toBeLessThanOrEqual(6);
    expect(second.attempts).toBeLessThanOrEqual(6);
    expect(first.history[0]).toMatchObject({ attempt: 1, guess: "raise" });
    expect(second.history[0]).toMatchObject({ attempt: 1, guess: "raise" });
    expect(firstUrls.every((url) => url.pathname === "/word/wrote")).toBe(true);
    expect(secondUrls.every((url) => url.pathname === "/word/apple")).toBe(true);
    expect([...firstSubmitted, ...secondSubmitted].every((guess) => allowedGuesses.has(guess))).toBe(
      true,
    );
    assertConsistentResult(first, firstSubmitted);
    assertConsistentResult(second, secondSubmitted);
  });
});
