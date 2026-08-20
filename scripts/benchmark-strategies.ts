import { performance } from "node:perf_hooks";
import {
  feedbackKeyForWords,
  precomputeLetterMasks,
  type LetterMask,
} from "../src/feedback.js";
import {
  buildFrequencyShortlist,
  chooseInformativeCandidate,
} from "../src/solver.js";
import { loadAnswerList, loadWordList } from "../src/word-list.js";

interface BenchmarkOptions {
  readonly sampleSize: number;
  readonly sampleSeed: number;
  readonly maxAttempts: number;
  readonly partitionBudget: number;
}

interface SolveMeasurement {
  readonly answer: string;
  readonly attempts: number;
  readonly solved: boolean;
  readonly selectorMs: number;
  readonly shortlistSizes: readonly number[];
}

interface StrategySummary {
  readonly name: string;
  readonly solved: number;
  readonly solveRate: number;
  readonly averageAttempts: number;
  readonly medianAttempts: number;
  readonly p95Attempts: number;
  readonly maxAttempts: number;
  readonly selectorMs: number;
  readonly averageSelectorMs: number;
  readonly averageShortlistSize: number;
}

type Selector = (
  candidates: readonly string[],
  attempted: ReadonlySet<string>,
) => { readonly guess: string; readonly shortlistSize: number };

const options = parseOptions(process.argv.slice(2));
const [answers, validGuesses] = await Promise.all([
  loadAnswerList({ size: 5 }),
  loadWordList({ size: 5 }),
]);
const allWords = [...new Set([...answers, ...validGuesses])];
const masks = precomputeLetterMasks(allWords);
const sample = selectSample(answers, options.sampleSize, options.sampleSeed, [
  "apple",
  "janet",
  "rater",
  "wrote",
]);

const fullSelector: Selector = (candidates, attempted) => ({
  guess: chooseInformativeCandidate(candidates, attempted, validGuesses, masks),
  shortlistSize: candidates.length === 1 ? 1 : validGuesses.length,
});

const hybridSelector: Selector = (candidates, attempted) => {
  if (candidates.length === 1) {
    return { guess: candidates[0] as string, shortlistSize: 1 };
  }

  const shortlist = buildFrequencyShortlist(
    candidates,
    attempted,
    validGuesses,
    masks,
    { partitionBudget: options.partitionBudget },
  );
  return {
    guess: chooseInformativeCandidate(candidates, attempted, shortlist, masks),
    shortlistSize: shortlist.length,
  };
};

warmUp(sample[0] as string, answers, masks, fullSelector, hybridSelector);

const fullResults: SolveMeasurement[] = [];
const hybridResults: SolveMeasurement[] = [];
const benchmarkStarted = performance.now();

for (let index = 0; index < sample.length; index += 1) {
  const answer = sample[index] as string;
  if (index % 2 === 0) {
    fullResults.push(simulate(answer, answers, masks, fullSelector, options.maxAttempts));
    hybridResults.push(simulate(answer, answers, masks, hybridSelector, options.maxAttempts));
  } else {
    hybridResults.push(simulate(answer, answers, masks, hybridSelector, options.maxAttempts));
    fullResults.push(simulate(answer, answers, masks, fullSelector, options.maxAttempts));
  }

  if ((index + 1) % 10 === 0 || index + 1 === sample.length) {
    console.log(`Completed ${index + 1}/${sample.length} answers`);
  }
}

const fullSummary = summarize("Full minimax", fullResults);
const hybridSummary = summarize("Frequency + partition", hybridResults);
const comparisons = compareResults(fullResults, hybridResults);
const elapsedMs = performance.now() - benchmarkStarted;

console.log("\nBenchmark configuration");
console.table({
  answers: answers.length,
  validGuesses: validGuesses.length,
  sampleSize: sample.length,
  sampleSeed: options.sampleSeed,
  maxAttempts: options.maxAttempts,
  partitionBudget: options.partitionBudget,
});
console.log("\nStrategy results");
console.table([fullSummary, hybridSummary]);
console.log("\nQuality comparison");
console.table({
  hybridFewerAttempts: comparisons.hybridFewer,
  equalAttempts: comparisons.equal,
  hybridMoreAttempts: comparisons.hybridMore,
  fullOnlySolved: comparisons.fullOnlySolved,
  hybridOnlySolved: comparisons.hybridOnlySolved,
  selectorSpeedup: formatNumber(fullSummary.selectorMs / hybridSummary.selectorMs),
  wallClockSeconds: formatNumber(elapsedMs / 1_000),
});

const regressions = comparisons.regressions.slice(0, 10);
if (regressions.length > 0) {
  console.log("\nLargest hybrid attempt regressions");
  console.table(regressions);
}

function simulate(
  answer: string,
  initialCandidates: readonly string[],
  wordMasks: ReadonlyMap<string, LetterMask>,
  selector: Selector,
  maxAttempts: number,
): SolveMeasurement {
  let candidates = [...initialCandidates];
  let guess = "raise";
  let selectorMs = 0;
  const attempted = new Set<string>();
  const shortlistSizes: number[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempted.add(guess);
    const pattern = feedbackKeyForWords(answer, guess, wordMasks.get(answer));
    if (pattern === "ccccc") {
      return { answer, attempts: attempt, solved: true, selectorMs, shortlistSizes };
    }

    candidates = candidates.filter(
      (candidate) =>
        !attempted.has(candidate) &&
        feedbackKeyForWords(candidate, guess, wordMasks.get(candidate)) === pattern,
    );
    if (candidates.length === 0 || attempt === maxAttempts) {
      return { answer, attempts: attempt, solved: false, selectorMs, shortlistSizes };
    }

    const started = performance.now();
    const selected = selector(candidates, attempted);
    selectorMs += performance.now() - started;
    shortlistSizes.push(selected.shortlistSize);
    guess = selected.guess;
  }

  return { answer, attempts: maxAttempts, solved: false, selectorMs, shortlistSizes };
}

function summarize(name: string, results: readonly SolveMeasurement[]): StrategySummary {
  const attempts = results.map(({ attempts }) => attempts).sort((left, right) => left - right);
  const solved = results.filter(({ solved: value }) => value).length;
  const selectorMs = results.reduce((total, result) => total + result.selectorMs, 0);
  const shortlistSizes = results.flatMap(({ shortlistSizes: values }) => values);
  return {
    name,
    solved,
    solveRate: Number(formatNumber((solved / results.length) * 100)),
    averageAttempts: Number(
      formatNumber(results.reduce((total, result) => total + result.attempts, 0) / results.length),
    ),
    medianAttempts: percentile(attempts, 0.5),
    p95Attempts: percentile(attempts, 0.95),
    maxAttempts: Math.max(...attempts),
    selectorMs: Number(formatNumber(selectorMs)),
    averageSelectorMs: Number(formatNumber(selectorMs / results.length)),
    averageShortlistSize: Number(
      formatNumber(
        shortlistSizes.length === 0
          ? 0
          : shortlistSizes.reduce((total, size) => total + size, 0) / shortlistSizes.length,
      ),
    ),
  };
}

function compareResults(full: readonly SolveMeasurement[], hybrid: readonly SolveMeasurement[]) {
  let hybridFewer = 0;
  let equal = 0;
  let hybridMore = 0;
  let fullOnlySolved = 0;
  let hybridOnlySolved = 0;
  const regressions: Array<{ answer: string; fullAttempts: number; hybridAttempts: number }> = [];

  for (let index = 0; index < full.length; index += 1) {
    const fullResult = full[index] as SolveMeasurement;
    const hybridResult = hybrid[index] as SolveMeasurement;
    if (fullResult.solved && !hybridResult.solved) fullOnlySolved++;
    if (!fullResult.solved && hybridResult.solved) hybridOnlySolved++;
    if (hybridResult.attempts < fullResult.attempts) hybridFewer++;
    else if (hybridResult.attempts > fullResult.attempts) {
      hybridMore++;
      regressions.push({
        answer: fullResult.answer,
        fullAttempts: fullResult.attempts,
        hybridAttempts: hybridResult.attempts,
      });
    } else equal++;
  }

  regressions.sort(
    (left, right) =>
      right.hybridAttempts - right.fullAttempts - (left.hybridAttempts - left.fullAttempts) ||
      left.answer.localeCompare(right.answer),
  );
  return { hybridFewer, equal, hybridMore, fullOnlySolved, hybridOnlySolved, regressions };
}

function warmUp(
  answer: string,
  initialCandidates: readonly string[],
  wordMasks: ReadonlyMap<string, LetterMask>,
  full: Selector,
  hybrid: Selector,
): void {
  const pattern = feedbackKeyForWords(answer, "raise", wordMasks.get(answer));
  const candidates = initialCandidates.filter(
    (candidate) =>
      feedbackKeyForWords(candidate, "raise", wordMasks.get(candidate)) === pattern,
  );
  const attempted = new Set(["raise"]);
  full(candidates, attempted);
  hybrid(candidates, attempted);
}

function selectSample(
  population: readonly string[],
  requestedSize: number,
  seed: number,
  anchors: readonly string[],
): string[] {
  const size = Math.min(requestedSize, population.length);
  const selected = new Set(anchors.filter((word) => population.includes(word)));
  const random = mulberry32(seed);
  while (selected.size < size) {
    selected.add(population[Math.floor(random() * population.length)] as string);
  }
  return [...selected];
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function formatNumber(value: number): string {
  return value.toFixed(2);
}

function parseOptions(argv: readonly string[]): BenchmarkOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined) {
      throw new Error(`Expected --flag value pairs, received: ${argv.join(" ")}`);
    }
    values.set(flag, value);
  }

  return {
    sampleSize: positiveInteger(values.get("--sample") ?? "100", "sample"),
    sampleSeed: safeInteger(values.get("--seed") ?? "20260820", "seed"),
    maxAttempts: positiveInteger(values.get("--max-attempts") ?? "6", "max-attempts"),
    partitionBudget: positiveInteger(values.get("--budget") ?? "1500000", "budget"),
  };
}

function positiveInteger(value: string, name: string): number {
  const parsed = safeInteger(value, name);
  if (parsed < 1) throw new Error(`${name} must be greater than zero.`);
  return parsed;
}

function safeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer.`);
  return parsed;
}
