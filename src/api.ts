import {
  resultKinds,
  targetSize,
  type GameTarget,
  type GuessResult,
  type GuessingApi,
  type ResultKind,
} from "./types.js";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface VoteeApiClientOptions {
  readonly baseUrl?: string;
  readonly fetchFn?: FetchLike;
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly retryDelayMs?: number;
}

export class VoteeApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "VoteeApiError";
  }
}

const letterPattern = /^[a-z]+$/i;

export class VoteeApiClient implements GuessingApi {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(options: VoteeApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://wordle.votee.dev:8000";
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retries = options.retries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 200;
  }

  async guess(target: GameTarget, guess: string): Promise<readonly GuessResult[]> {
    const size = targetSize(target);
    const normalizedGuess = guess.toLowerCase();
    if (!letterPattern.test(normalizedGuess) || normalizedGuess.length !== size) {
      throw new VoteeApiError(`Guess must contain exactly ${size} ASCII letters.`);
    }

    const url = this.buildUrl(target, normalizedGuess);
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        return await this.request(url, normalizedGuess, size);
      } catch (error) {
        lastError = error;
        if (!this.shouldRetry(error) || attempt === this.retries) {
          throw error;
        }
        await delay(this.retryDelayMs * 2 ** attempt);
      }
    }

    throw new VoteeApiError("Votee API request failed.", undefined, { cause: lastError });
  }

  private buildUrl(target: GameTarget, guess: string): URL {
    let path: string;
    switch (target.mode) {
      case "random":
        path = "/random";
        break;
      case "daily":
        path = "/daily";
        break;
      case "word":
        path = `/word/${encodeURIComponent(target.word.toLowerCase())}`;
        break;
    }

    const url = new URL(path, ensureTrailingSlash(this.baseUrl));
    url.searchParams.set("guess", guess);
    if (target.mode !== "word") {
      url.searchParams.set("size", String(target.size));
    }
    if (target.mode === "random") {
      url.searchParams.set("seed", String(target.seed));
    }
    return url;
  }

  private async request(url: URL, guess: string, size: number): Promise<GuessResult[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new VoteeApiError(
          `Votee API returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
          response.status,
        );
      }

      const payload: unknown = await response.json();
      return validateFeedback(payload, guess, size);
    } catch (error) {
      if (error instanceof VoteeApiError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new VoteeApiError(`Could not reach the Votee API: ${message}`, undefined, {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private shouldRetry(error: unknown): boolean {
    return (
      error instanceof VoteeApiError &&
      (error.status === undefined || error.status === 429 || error.status >= 500)
    );
  }
}

function validateFeedback(payload: unknown, guess: string, size: number): GuessResult[] {
  if (!Array.isArray(payload) || payload.length !== size) {
    throw new VoteeApiError(`Invalid API response: expected ${size} result items.`);
  }

  const seenSlots = new Set<number>();
  const feedback = payload.map((item): GuessResult => {
    if (typeof item !== "object" || item === null) {
      throw new VoteeApiError("Invalid API response: result item is not an object.");
    }

    const record = item as Record<string, unknown>;
    const slot = record.slot;
    const character = record.guess;
    const result = record.result;

    if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) >= size) {
      throw new VoteeApiError("Invalid API response: result has an invalid slot.");
    }
    if (seenSlots.has(slot as number)) {
      throw new VoteeApiError("Invalid API response: result contains duplicate slots.");
    }
    seenSlots.add(slot as number);

    if (character !== guess[slot as number]) {
      throw new VoteeApiError("Invalid API response: echoed guess character does not match.");
    }
    if (typeof result !== "string" || !resultKinds.includes(result as ResultKind)) {
      throw new VoteeApiError("Invalid API response: unknown result kind.");
    }

    return { slot: slot as number, guess: character as string, result: result as ResultKind };
  });

  return feedback.sort((left, right) => left.slot - right.slot);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
