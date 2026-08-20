import type { GameTarget } from "./types.js";
import { DEFAULT_PARTITION_BUDGET } from "./solver.js";

export interface CliOptions {
  readonly target: GameTarget;
  readonly wordListPath?: string;
  readonly firstGuess?: string;
  readonly maxAttempts: number;
  readonly partitionBudget: number;
  readonly baseUrl: string;
}

export type ParseResult =
  | { readonly kind: "help" }
  | { readonly kind: "run"; readonly options: CliOptions };

export function parseCliOptions(
  argv: readonly string[],
  createSeed: () => number,
): ParseResult {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { kind: "help" };
  }

  const args = [...argv];
  const requestedMode = args.shift() ?? "random";
  if (requestedMode !== "random" && requestedMode !== "daily" && requestedMode !== "word") {
    throw new Error(`Unknown mode: ${requestedMode}. Expected random, daily, or word.`);
  }
  const mode: "random" | "daily" | "word" = requestedMode;

  let word: string | undefined;
  if (mode === "word") {
    word = args.shift()?.toLowerCase();
    if (word === undefined || !/^[a-z]+$/.test(word)) {
      throw new Error("word mode requires an ASCII-letter target, for example: word apple");
    }
  }

  let size = mode === "word" ? (word as string).length : 5;
  let seed: number | undefined;
  let wordListPath: string | undefined;
  let firstGuess: string | undefined;
  let maxAttempts = 12;
  let partitionBudget = DEFAULT_PARTITION_BUDGET;
  let baseUrl = "https://wordle.votee.dev:8000";

  while (args.length > 0) {
    const flag = args.shift();
    const value = args.shift();
    if (value === undefined) {
      throw new Error(`Missing value for ${flag}.`);
    }

    switch (flag) {
      case "--size":
        size = parsePositiveInteger(value, "size");
        break;
      case "--seed":
        seed = parseSafeInteger(value, "seed");
        break;
      case "--word-list":
        wordListPath = value;
        break;
      case "--first":
        firstGuess = value.toLowerCase();
        break;
      case "--max-attempts":
        maxAttempts = parsePositiveInteger(value, "max-attempts");
        break;
      case "--partition-budget":
        partitionBudget = parsePositiveInteger(value, "partition-budget");
        break;
      case "--base-url":
        baseUrl = value;
        break;
      default:
        throw new Error(`Unknown option: ${flag}.`);
    }
  }

  if (mode === "word" && size !== word?.length) {
    throw new Error("--size cannot differ from the target word length in word mode.");
  }
  if (mode !== "random" && seed !== undefined) {
    throw new Error("--seed is only valid in random mode.");
  }

  let target: GameTarget;
  if (mode === "random") {
    target = { mode, size, seed: seed ?? createSeed() };
  } else if (mode === "daily") {
    target = { mode, size };
  } else {
    target = { mode, word: word as string };
  }

  const options: CliOptions = { target, maxAttempts, partitionBudget, baseUrl };
  return {
    kind: "run",
    options: {
      ...options,
      ...(wordListPath === undefined ? {} : { wordListPath }),
      ...(firstGuess === undefined ? {} : { firstGuess }),
    },
  };
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = parseSafeInteger(value, name);
  if (parsed < 1) {
    throw new Error(`${name} must be greater than zero.`);
  }
  return parsed;
}

function parseSafeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a safe integer.`);
  }
  return parsed;
}
