import { describe, expect, it, vi } from "vitest";
import { parseCliOptions } from "../src/cli-options.js";

describe("parseCliOptions production boundaries", () => {
  it("creates exactly one stable seed for an unseeded random run", () => {
    const createSeed = vi.fn(() => 867_530_9);

    const parsed = parseCliOptions(["random", "--size", "5"], createSeed);

    expect(parsed).toEqual({
      kind: "run",
      options: {
        target: { mode: "random", size: 5, seed: 8_675_309 },
        maxAttempts: 12,
        partitionBudget: 1_500_000,
        baseUrl: "https://wordle.votee.dev:8000",
      },
    });
    expect(createSeed).toHaveBeenCalledTimes(1);
  });

  it("accepts safe positive boundaries and rejects invalid numeric limits", () => {
    const createSeed = vi.fn(() => 1);

    expect(
      parseCliOptions(
        [
          "random",
          "--seed",
          String(Number.MAX_SAFE_INTEGER),
          "--size",
          "1",
          "--max-attempts",
          "1",
        ],
        createSeed,
      ),
    ).toMatchObject({
      kind: "run",
      options: {
        target: { mode: "random", seed: Number.MAX_SAFE_INTEGER, size: 1 },
        maxAttempts: 1,
      },
    });
    expect(() =>
      parseCliOptions(["random", "--seed", "9007199254740992"], createSeed),
    ).toThrow("seed must be a safe integer.");
    expect(() => parseCliOptions(["random", "--seed", "1.5"], createSeed)).toThrow(
      "seed must be a safe integer.",
    );
    expect(() => parseCliOptions(["random", "--size", "0"], createSeed)).toThrow(
      "size must be greater than zero.",
    );
    expect(() =>
      parseCliOptions(["random", "--max-attempts", "-1"], createSeed),
    ).toThrow("max-attempts must be greater than zero.");
    expect(createSeed).not.toHaveBeenCalled();
  });

  it("rejects flags that conflict with the selected mode before generating a seed", () => {
    const createSeed = vi.fn(() => 99);

    expect(() => parseCliOptions(["daily", "--seed", "7"], createSeed)).toThrow(
      "--seed is only valid in random mode.",
    );
    expect(() => parseCliOptions(["word", "APPLE", "--seed", "7"], createSeed)).toThrow(
      "--seed is only valid in random mode.",
    );
    expect(() => parseCliOptions(["word", "APPLE", "--size", "4"], createSeed)).toThrow(
      "--size cannot differ from the target word length in word mode.",
    );
    expect(createSeed).not.toHaveBeenCalled();
  });

  it("preserves a complete custom word-mode configuration and normalizes words", () => {
    const createSeed = vi.fn(() => 99);

    expect(
      parseCliOptions(
        [
          "word",
          "APPLE",
          "--size",
          "5",
          "--word-list",
          "/tmp/custom-five-letter-words.txt",
          "--first",
          "RAISE",
          "--max-attempts",
          "6",
          "--partition-budget",
          "750000",
          "--base-url",
          "http://localhost:8080/wordle",
        ],
        createSeed,
      ),
    ).toEqual({
      kind: "run",
      options: {
        target: { mode: "word", word: "apple" },
        wordListPath: "/tmp/custom-five-letter-words.txt",
        firstGuess: "raise",
        maxAttempts: 6,
        partitionBudget: 750_000,
        baseUrl: "http://localhost:8080/wordle",
      },
    });
    expect(createSeed).not.toHaveBeenCalled();
  });

  it("short-circuits global help and reports missing or unknown arguments", () => {
    const createSeed = vi.fn(() => 99);

    expect(parseCliOptions(["--help", "--seed"], createSeed)).toEqual({ kind: "help" });
    expect(parseCliOptions(["not-a-mode", "-h"], createSeed)).toEqual({ kind: "help" });
    expect(() => parseCliOptions(["random", "--first"], createSeed)).toThrow(
      "Missing value for --first.",
    );
    expect(() => parseCliOptions(["mystery"], createSeed)).toThrow(
      "Unknown mode: mystery. Expected random, daily, or word.",
    );
    expect(() => parseCliOptions(["random", "--mystery", "value"], createSeed)).toThrow(
      "Unknown option: --mystery.",
    );
    expect(() => parseCliOptions(["word"], createSeed)).toThrow(
      "word mode requires an ASCII-letter target, for example: word apple",
    );
    expect(createSeed).not.toHaveBeenCalled();
  });
});
