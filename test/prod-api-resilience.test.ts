import { describe, expect, it, vi } from "vitest";
import { VoteeApiClient, VoteeApiError, type FetchLike } from "../src/api.js";
import { scoreGuess } from "../src/feedback.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("VoteeApiClient production resilience", () => {
  it("retries HTTP 429 and 5xx responses but never retries ordinary 4xx responses", async () => {
    for (const status of [429, 500, 503]) {
      const fetchFn = vi.fn<FetchLike>(async () =>
        jsonResponse({ detail: "transient failure" }, status),
      );
      const client = new VoteeApiClient({ fetchFn, retries: 2, retryDelayMs: 0 });

      await expect(client.guess({ mode: "word", word: "apple" }, "raise")).rejects.toMatchObject<
        Partial<VoteeApiError>
      >({ status });
      expect(fetchFn, `HTTP ${status} should consume the retry budget`).toHaveBeenCalledTimes(3);
    }

    for (const status of [400, 404, 422]) {
      const fetchFn = vi.fn<FetchLike>(async () =>
        jsonResponse({ detail: "permanent client failure" }, status),
      );
      const client = new VoteeApiClient({ fetchFn, retries: 2, retryDelayMs: 0 });

      await expect(client.guess({ mode: "word", word: "apple" }, "raise")).rejects.toMatchObject<
        Partial<VoteeApiError>
      >({ status });
      expect(fetchFn, `HTTP ${status} should fail fast`).toHaveBeenCalledTimes(1);
    }
  });

  it("recovers when a rate limit and server outage are followed by a valid response", async () => {
    const validFeedback = scoreGuess("apple", "raise");
    const fetchFn = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ detail: "rate limited" }, 429))
      .mockResolvedValueOnce(jsonResponse({ detail: "unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse(validFeedback));
    const client = new VoteeApiClient({ fetchFn, retries: 2, retryDelayMs: 0 });

    await expect(client.guess({ mode: "word", word: "apple" }, "raise")).resolves.toEqual(
      validFeedback,
    );
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("retries network failures and preserves the final failure as the error cause", async () => {
    const networkFailure = new TypeError("socket disconnected");
    const fetchFn = vi.fn<FetchLike>(async () => {
      throw networkFailure;
    });
    const client = new VoteeApiClient({ fetchFn, retries: 2, retryDelayMs: 0 });

    await expect(client.guess({ mode: "daily", size: 5 }, "raise")).rejects.toMatchObject({
      name: "VoteeApiError",
      message: "Could not reach the Votee API: socket disconnected",
      status: undefined,
      cause: networkFailure,
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid slots, result kinds, and echoed guess characters", async () => {
    const validFeedback = scoreGuess("apple", "raise");
    const malformedCases: ReadonlyArray<{
      readonly label: string;
      readonly payload: unknown;
      readonly message: RegExp;
    }> = [
      {
        label: "out-of-range slot",
        payload: validFeedback.map((item, index) => (index === 0 ? { ...item, slot: 5 } : item)),
        message: /invalid slot/,
      },
      {
        label: "unknown result kind",
        payload: validFeedback.map((item, index) =>
          index === 0 ? { ...item, result: "almost" } : item,
        ),
        message: /unknown result kind/,
      },
      {
        label: "mismatched echoed character",
        payload: validFeedback.map((item, index) =>
          index === 0 ? { ...item, guess: "x" } : item,
        ),
        message: /echoed guess character does not match/,
      },
    ];

    for (const malformed of malformedCases) {
      const fetchFn = vi.fn<FetchLike>(async () => jsonResponse(malformed.payload));
      const client = new VoteeApiClient({ fetchFn, retries: 0 });

      await expect(
        client.guess({ mode: "word", word: "apple" }, "raise"),
        malformed.label,
      ).rejects.toThrow(malformed.message);
      expect(fetchFn, malformed.label).toHaveBeenCalledTimes(1);
    }
  });

  it("uses the configured base URL and percent-encodes the selected word path", async () => {
    const fetchFn = vi.fn<FetchLike>(async () => jsonResponse(scoreGuess("apple", "raise")));
    const client = new VoteeApiClient({
      baseUrl: "https://api.example.test:8443/service",
      fetchFn,
      retries: 0,
    });

    await client.guess({ mode: "word", word: "A/B?C" }, "RAISE");

    const [input, init] = fetchFn.mock.calls[0]!;
    const requestedUrl = new URL(String(input));
    expect(requestedUrl.origin).toBe("https://api.example.test:8443");
    expect(requestedUrl.pathname).toBe("/word/a%2Fb%3Fc");
    expect([...requestedUrl.searchParams]).toEqual([["guess", "raise"]]);
    expect(init).toMatchObject({ headers: { accept: "application/json" } });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
