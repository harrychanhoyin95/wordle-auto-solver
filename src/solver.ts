import {
  feedbackKeyForWords,
  filterCandidates,
  isSolved,
  precomputeLetterMasks,
  type LetterMask,
} from "./feedback.js";
import { targetSize, type GameTarget, type GuessResult, type GuessingApi } from "./types.js";

export interface SolverProgress {
  readonly attempt: number;
  readonly guess: string;
  readonly feedback: readonly GuessResult[];
  readonly candidatesBefore: number;
  readonly candidatesAfter: number;
}

export interface SolverOptions {
  readonly firstGuess?: string;
  readonly maxAttempts?: number;
  readonly partitionBudget?: number;
  readonly onProgress?: (progress: SolverProgress) => void;
}

export interface HybridSelectionOptions {
  readonly partitionBudget?: number;
  readonly fullScanThreshold?: number;
  readonly minimumShortlistSize?: number;
}

export const DEFAULT_PARTITION_BUDGET = 1_500_000;
export const DEFAULT_FULL_SCAN_THRESHOLD = 100;
export const DEFAULT_MINIMUM_SHORTLIST_SIZE = 512;

export interface SolveResult {
  readonly answer: string;
  readonly attempts: number;
  readonly history: readonly SolverProgress[];
}

export class SolverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolverError";
  }
}

export class WordleSolver {
  constructor(
    private readonly api: GuessingApi,
    candidateWords: readonly string[],
    guessWords: readonly string[] = candidateWords,
  ) {
    this.candidateWords = normalizeWords(candidateWords);
    this.guessWords = normalizeWords(guessWords);
    const dictionaryBackedWords = [...new Set([...this.candidateWords, ...this.guessWords])];
    this.allowedGuesses = new Set(dictionaryBackedWords);
    this.wordMasks = precomputeLetterMasks(dictionaryBackedWords);
  }

  private readonly candidateWords: readonly string[];
  private readonly guessWords: readonly string[];
  private readonly allowedGuesses: ReadonlySet<string>;
  private readonly wordMasks: ReadonlyMap<string, LetterMask>;

  async solve(target: GameTarget, options: SolverOptions = {}): Promise<SolveResult> {
    const size = targetSize(target);
    let candidates = this.candidateWords.filter((word) => word.length === size);
    if (candidates.length === 0) {
      throw new SolverError(`The word list has no ${size}-letter candidates.`);
    }
    const guessPool = this.guessWords.filter((word) => word.length === size);
    if (guessPool.length === 0) {
      throw new SolverError(`The valid-guess list has no ${size}-letter words.`);
    }

    const maxAttempts = options.maxAttempts ?? 12;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
      throw new SolverError("maxAttempts must be a positive integer.");
    }
    const partitionBudget = options.partitionBudget ?? DEFAULT_PARTITION_BUDGET;
    if (!Number.isSafeInteger(partitionBudget) || partitionBudget < 1) {
      throw new SolverError("partitionBudget must be a positive integer.");
    }

    const attempted = new Set<string>();
    const history: SolverProgress[] = [];
    let nextGuess = this.chooseFirstGuess(
      candidates,
      guessPool,
      size,
      partitionBudget,
      options.firstGuess,
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (!this.allowedGuesses.has(nextGuess)) {
        throw new SolverError(
          `Guess ${nextGuess.toUpperCase()} is not present in the configured valid-word list.`,
        );
      }
      if (attempted.has(nextGuess)) {
        throw new SolverError(`Solver selected the repeated guess ${nextGuess}.`);
      }
      attempted.add(nextGuess);

      const candidatesBefore = candidates.length;
      const feedback = await this.api.guess(target, nextGuess);
      if (isSolved(feedback)) {
        const progress: SolverProgress = {
          attempt,
          guess: nextGuess,
          feedback,
          candidatesBefore,
          candidatesAfter: 1,
        };
        history.push(progress);
        options.onProgress?.(progress);
        return { answer: nextGuess, attempts: attempt, history };
      }

      candidates = filterCandidates(candidates, nextGuess, feedback, this.wordMasks).filter(
        (candidate) => !attempted.has(candidate),
      );
      const progress: SolverProgress = {
        attempt,
        guess: nextGuess,
        feedback,
        candidatesBefore,
        candidatesAfter: candidates.length,
      };
      history.push(progress);
      options.onProgress?.(progress);

      if (candidates.length === 0) {
        throw new SolverError(
          "No candidate matches the API feedback. Supply a word list containing the answer.",
        );
      }

      if (attempt === maxAttempts) {
        break;
      }

      nextGuess = chooseHybridCandidate(candidates, attempted, guessPool, this.wordMasks, {
        partitionBudget,
      });
    }

    throw new SolverError(`Could not solve the puzzle within ${maxAttempts} attempts.`);
  }

  private chooseFirstGuess(
    candidates: readonly string[],
    guessPool: readonly string[],
    size: number,
    partitionBudget: number,
    requested?: string,
  ): string {
    if (requested !== undefined) {
      const normalized = requested.toLowerCase();
      if (!/^[a-z]+$/.test(normalized) || normalized.length !== size) {
        throw new SolverError(`First guess must contain exactly ${size} ASCII letters.`);
      }
      if (!this.allowedGuesses.has(normalized)) {
        throw new SolverError(
          `First guess ${normalized.toUpperCase()} is not present in the configured valid-word list.`,
        );
      }
      return normalized;
    }

    if (size === 5 && guessPool.includes("raise")) {
      return "raise";
    }
    return chooseHybridCandidate(candidates, new Set(), guessPool, this.wordMasks, {
      partitionBudget,
    });
  }
}

export function chooseHybridCandidate(
  candidates: readonly string[],
  attempted: ReadonlySet<string>,
  guessPool: readonly string[] = candidates,
  precomputedMasks: ReadonlyMap<string, LetterMask> = precomputeLetterMasks([
    ...new Set([...candidates, ...guessPool]),
  ]),
  options: HybridSelectionOptions = {},
): string {
  const availableCandidates = candidates.filter((word) => !attempted.has(word));
  const firstCandidate = availableCandidates[0];
  if (firstCandidate === undefined) {
    throw new SolverError("There are no untried candidates left.");
  }
  if (availableCandidates.length === 1) return firstCandidate;

  const shortlist = buildFrequencyShortlist(
    availableCandidates,
    attempted,
    guessPool,
    precomputedMasks,
    options,
  );
  return chooseInformativeCandidate(availableCandidates, attempted, shortlist, precomputedMasks);
}

export function buildFrequencyShortlist(
  candidates: readonly string[],
  attempted: ReadonlySet<string>,
  guessPool: readonly string[],
  precomputedMasks: ReadonlyMap<string, LetterMask>,
  options: HybridSelectionOptions = {},
): string[] {
  const partitionBudget = positiveSelectionOption(
    options.partitionBudget ?? DEFAULT_PARTITION_BUDGET,
    "partitionBudget",
  );
  const fullScanThreshold = nonNegativeSelectionOption(
    options.fullScanThreshold ?? DEFAULT_FULL_SCAN_THRESHOLD,
    "fullScanThreshold",
  );
  const minimumShortlistSize = positiveSelectionOption(
    options.minimumShortlistSize ?? DEFAULT_MINIMUM_SHORTLIST_SIZE,
    "minimumShortlistSize",
  );
  const guessSet = new Set(guessPool);
  const availableGuesses = guessPool.filter(
    (guess) => !attempted.has(guess) && guess.length === candidates[0]?.length,
  );
  if (candidates.length <= fullScanThreshold) return availableGuesses;

  const wordLength = candidates[0]?.length ?? 0;
  const positional = Array.from({ length: wordLength }, () => new Uint32Array(26));
  const presence = new Uint32Array(26);

  for (const candidate of candidates) {
    for (let slot = 0; slot < candidate.length; slot += 1) {
      const index = candidate.charCodeAt(slot) - 97;
      const counts = positional[slot];
      if (counts !== undefined) counts[index] = (counts[index] ?? 0) + 1;
    }
    const mask = precomputedMasks.get(candidate) ?? 0;
    for (let index = 0; index < 26; index += 1) {
      if ((mask & (1 << index)) !== 0) presence[index] = (presence[index] ?? 0) + 1;
    }
  }

  const adaptiveSize = Math.min(
    availableGuesses.length,
    Math.max(minimumShortlistSize, Math.floor(partitionBudget / candidates.length)),
  );
  const ranked = availableGuesses
    .map((guess) => ({ guess, score: frequencyScore(guess, positional, presence) }))
    .sort((left, right) => right.score - left.score || left.guess.localeCompare(right.guess));
  const shortlist = new Set(ranked.slice(0, adaptiveSize).map(({ guess }) => guess));

  for (const candidate of candidates) {
    if (guessSet.has(candidate) && !attempted.has(candidate)) shortlist.add(candidate);
  }
  return [...shortlist];
}

export function chooseInformativeCandidate(
  candidates: readonly string[],
  attempted: ReadonlySet<string>,
  guessPool: readonly string[] = candidates,
  precomputedMasks: ReadonlyMap<string, LetterMask> = precomputeLetterMasks(candidates),
): string {
  const availableCandidates = candidates.filter((word) => !attempted.has(word));
  const firstCandidate = availableCandidates[0];
  if (firstCandidate === undefined) {
    throw new SolverError("There are no untried candidates left.");
  }
  if (availableCandidates.length === 1) {
    return firstCandidate;
  }

  const candidateSet = new Set(availableCandidates);
  let bestGuess: string | undefined;
  let bestWorstBucket = Number.POSITIVE_INFINITY;
  let bestSumOfSquares = Number.POSITIVE_INFINITY;
  let bestIsCandidate = false;

  for (const guess of guessPool) {
    if (attempted.has(guess) || guess.length !== firstCandidate.length) continue;

    const buckets = new Map<string, number>();
    let worstBucket = 0;
    let pruned = false;

    for (const candidate of availableCandidates) {
      const pattern = feedbackKeyForWords(candidate, guess, precomputedMasks.get(candidate));
      const count = (buckets.get(pattern) ?? 0) + 1;
      buckets.set(pattern, count);
      worstBucket = Math.max(worstBucket, count);
      if (worstBucket > bestWorstBucket) {
        pruned = true;
        break;
      }
    }
    if (pruned) continue;

    let sumOfSquares = 0;
    for (const count of buckets.values()) {
      sumOfSquares += count * count;
    }
    const isCandidate = candidateSet.has(guess);
    const isBetter =
      worstBucket < bestWorstBucket ||
      (worstBucket === bestWorstBucket && sumOfSquares < bestSumOfSquares) ||
      (worstBucket === bestWorstBucket &&
        sumOfSquares === bestSumOfSquares &&
        isCandidate &&
        !bestIsCandidate) ||
      (worstBucket === bestWorstBucket &&
        sumOfSquares === bestSumOfSquares &&
        isCandidate === bestIsCandidate &&
        (bestGuess === undefined || guess.localeCompare(bestGuess) < 0));

    if (isBetter) {
      bestGuess = guess;
      bestWorstBucket = worstBucket;
      bestSumOfSquares = sumOfSquares;
      bestIsCandidate = isCandidate;
    }
  }

  if (bestGuess === undefined) {
    throw new SolverError("There are no usable guesses left in the guess pool.");
  }
  return bestGuess;
}

function frequencyScore(
  word: string,
  positional: readonly Uint32Array[],
  presence: Uint32Array,
): number {
  let score = 0;
  let seen = 0;
  for (let slot = 0; slot < word.length; slot += 1) {
    const index = word.charCodeAt(slot) - 97;
    score += (positional[slot]?.[index] ?? 0) * 2;
    const bit = 1 << index;
    if ((seen & bit) === 0) {
      score += presence[index] ?? 0;
      seen |= bit;
    }
  }
  return score;
}

function positiveSelectionOption(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new SolverError(`${name} must be a positive integer.`);
  }
  return value;
}

function nonNegativeSelectionOption(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SolverError(`${name} must be a non-negative integer.`);
  }
  return value;
}

function normalizeWords(words: readonly string[]): string[] {
  return [
    ...new Set(
      words
        .map((word) => word.trim().toLowerCase())
        .filter((word) => /^[a-z]+$/.test(word)),
    ),
  ];
}
