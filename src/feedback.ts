import type { GuessResult, ResultKind } from "./types.js";

export type LetterMask = number;

export function createLetterMask(word: string): LetterMask {
  let mask = 0;
  for (const character of word.toLowerCase()) {
    const index = character.charCodeAt(0) - 97;
    if (index < 0 || index >= 26) {
      throw new Error(`Cannot create a letter mask for non-ASCII word: ${word}.`);
    }
    mask |= 1 << index;
  }
  return mask;
}

export function precomputeLetterMasks(words: readonly string[]): ReadonlyMap<string, LetterMask> {
  return new Map(words.map((word) => [word, createLetterMask(word)]));
}

/**
 * Reproduces Votee's API semantics.
 *
 * Votee marks a misplaced character as `present` whenever the target contains
 * that character. It does not consume duplicate-letter counts like the
 * original Wordle game does. For example, guessing `allee` against `apple`
 * produces correct,present,present,present,correct.
 */
export function scoreGuess(target: string, guess: string): GuessResult[] {
  if (target.length !== guess.length) {
    throw new Error(
      `Target and guess must have the same length (got ${target.length} and ${guess.length}).`,
    );
  }

  const normalizedTarget = target.toLowerCase();
  const normalizedGuess = guess.toLowerCase();
  const targetMask = createLetterMask(normalizedTarget);

  return [...normalizedGuess].map((character, slot) => {
    let result: ResultKind = "absent";
    if (normalizedTarget[slot] === character) {
      result = "correct";
    } else if (maskContains(targetMask, character)) {
      result = "present";
    }

    return { slot, guess: character, result };
  });
}

export function feedbackKey(feedback: readonly GuessResult[]): string {
  return [...feedback]
    .sort((left, right) => left.slot - right.slot)
    .map(({ result }) => result[0])
    .join("");
}

export function feedbackKeyForWords(
  target: string,
  guess: string,
  precomputedTargetMask?: LetterMask,
): string {
  if (target.length !== guess.length) {
    throw new Error(
      `Target and guess must have the same length (got ${target.length} and ${guess.length}).`,
    );
  }

  const normalizedTarget = target.toLowerCase();
  const normalizedGuess = guess.toLowerCase();
  const targetMask = precomputedTargetMask ?? createLetterMask(normalizedTarget);
  let key = "";
  for (let slot = 0; slot < normalizedGuess.length; slot += 1) {
    const character = normalizedGuess[slot];
    if (character === undefined) continue;
    key +=
      normalizedTarget[slot] === character
        ? "c"
        : maskContains(targetMask, character)
          ? "p"
          : "a";
  }
  return key;
}

export function isSolved(feedback: readonly GuessResult[]): boolean {
  return feedback.length > 0 && feedback.every(({ result }) => result === "correct");
}

export function matchesFeedback(
  candidate: string,
  guess: string,
  feedback: readonly GuessResult[],
): boolean {
  return feedbackKeyForWords(candidate, guess) === feedbackKey(feedback);
}

export function filterCandidates(
  candidates: readonly string[],
  guess: string,
  feedback: readonly GuessResult[],
  precomputedMasks?: ReadonlyMap<string, LetterMask>,
): string[] {
  const expectedKey = feedbackKey(feedback);
  return candidates.filter(
    (candidate) =>
      feedbackKeyForWords(candidate, guess, precomputedMasks?.get(candidate)) === expectedKey,
  );
}

function maskContains(mask: LetterMask, character: string): boolean {
  const index = character.charCodeAt(0) - 97;
  return index >= 0 && index < 26 && (mask & (1 << index)) !== 0;
}
