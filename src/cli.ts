#!/usr/bin/env node
import { randomInt } from "node:crypto";
import { VoteeApiClient } from "./api.js";
import { parseCliOptions } from "./cli-options.js";
import { WordleSolver } from "./solver.js";
import { targetSize, type GuessResult } from "./types.js";
import { loadAnswerList, loadWordList } from "./word-list.js";

const helpText = `Votee Wordle auto-solver

Usage:
  npm run solve -- random [options]
  npm run solve -- daily [options]
  npm run solve -- word <answer> [options]

Options:
  --seed <integer>       Stable random puzzle seed (random mode only)
  --size <integer>       Puzzle size for random/daily mode (default: 5)
  --word-list <path>     Newline- or whitespace-separated candidate list
  --first <word>         Override the first guess (must be in the word list)
  --max-attempts <n>     Stop after this many requests (default: 12)
  --base-url <url>       Override the Votee API base URL
  --help, -h             Show this help

Examples:
  npm run solve -- random
  npm run solve -- random --seed 42
  npm run solve -- daily
  npm run solve -- word apple --first raise
`;

async function main(): Promise<void> {
  const parsed = parseCliOptions(process.argv.slice(2), () => randomInt(0, 2_147_483_647));
  if (parsed.kind === "help") {
    console.log(helpText);
    return;
  }

  const { options } = parsed;
  const size = targetSize(options.target);
  const guessWords = await loadWordList({
    size,
    ...(options.wordListPath === undefined ? {} : { path: options.wordListPath }),
  });
  const answerWords =
    options.wordListPath === undefined
      ? await loadAnswerList({ size })
      : guessWords;
  const client = new VoteeApiClient({ baseUrl: options.baseUrl });
  const solver = new WordleSolver(client, answerWords, guessWords);

  console.log(`Mode: ${describeTarget(options.target)}`);
  console.log(
    `Candidates: ${answerWords.length.toLocaleString("en-US")}; ` +
      `valid guesses: ${guessWords.length.toLocaleString("en-US")}`,
  );

  const result = await solver.solve(options.target, {
    maxAttempts: options.maxAttempts,
    ...(options.firstGuess === undefined ? {} : { firstGuess: options.firstGuess }),
    onProgress: ({ attempt, guess, feedback, candidatesAfter }) => {
      console.log(
        `${String(attempt).padStart(2, " ")}. ${guess.toUpperCase()}  ${renderFeedback(feedback)}  ` +
          `${candidatesAfter.toLocaleString("en-US")} candidate(s)`,
      );
    },
  });

  console.log(`Solved: ${result.answer.toUpperCase()} in ${result.attempts} attempt(s).`);
  if (options.target.mode === "random") {
    console.log(
      `Random seed ${options.target.seed} answer: ${result.answer.toUpperCase()}`,
    );
  }
}

function describeTarget(target: Parameters<typeof targetSize>[0]): string {
  switch (target.mode) {
    case "random":
      return `random, size=${target.size}, seed=${target.seed}`;
    case "daily":
      return `daily, size=${target.size}`;
    case "word":
      return `selected word, size=${target.word.length}`;
  }
}

function renderFeedback(feedback: readonly GuessResult[]): string {
  return feedback
    .map(({ result }) => {
      switch (result) {
        case "correct":
          return "🟩";
        case "present":
          return "🟨";
        case "absent":
          return "⬛";
      }
    })
    .join("");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
