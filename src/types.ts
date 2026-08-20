export const resultKinds = ["absent", "present", "correct"] as const;

export type ResultKind = (typeof resultKinds)[number];

export interface GuessResult {
  readonly slot: number;
  readonly guess: string;
  readonly result: ResultKind;
}

export type GameTarget =
  | { readonly mode: "random"; readonly seed: number; readonly size: number }
  | { readonly mode: "daily"; readonly size: number }
  | { readonly mode: "word"; readonly word: string };

export interface GuessingApi {
  guess(target: GameTarget, guess: string): Promise<readonly GuessResult[]>;
}

export function targetSize(target: GameTarget): number {
  return target.mode === "word" ? target.word.length : target.size;
}
