import { describe, expect, it } from "vitest";
import { parseCliOptions } from "../src/cli-options.js";

describe("parseCliOptions", () => {
  it("defaults to a random five-letter puzzle and creates one seed", () => {
    let calls = 0;
    const parsed = parseCliOptions([], () => {
      calls += 1;
      return 77;
    });

    expect(parsed).toMatchObject({
      kind: "run",
      options: { target: { mode: "random", size: 5, seed: 77 } },
    });
    expect(calls).toBe(1);
  });

  it("combines random mode options", () => {
    const parsed = parseCliOptions(
      [
        "random",
        "--seed",
        "42",
        "--size",
        "6",
        "--word-list",
        "six.txt",
        "--first",
        "planet",
        "--max-attempts",
        "9",
        "--partition-budget",
        "250000",
      ],
      () => 1,
    );

    expect(parsed).toEqual({
      kind: "run",
      options: {
        target: { mode: "random", size: 6, seed: 42 },
        wordListPath: "six.txt",
        firstGuess: "planet",
        maxAttempts: 9,
        partitionBudget: 250_000,
        baseUrl: "https://wordle.votee.dev:8000",
      },
    });
  });

  it.each([
    [["daily"], { mode: "daily", size: 5 }],
    [["word", "apple"], { mode: "word", word: "apple" }],
  ] as const)("parses %s mode", (args, target) => {
    expect(parseCliOptions(args, () => 1)).toMatchObject({ kind: "run", options: { target } });
  });

  it.each([
    [["daily", "--seed", "1"], /only valid in random/],
    [["word"], /requires/],
    [["random", "--size", "0"], /greater than zero/],
    [["random", "--partition-budget", "0"], /greater than zero/],
    [["random", "--unknown", "x"], /Unknown option/],
    [["word", "apple", "--size", "4"], /cannot differ/],
  ] as const)("rejects invalid combination %#", (args, expected) => {
    expect(() => parseCliOptions(args, () => 1)).toThrow(expected);
  });
});
