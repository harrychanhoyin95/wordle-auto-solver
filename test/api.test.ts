import { describe, expect, it, vi } from "vitest";
import { VoteeApiClient, VoteeApiError, type FetchLike } from "../src/api.js";
import { scoreGuess } from "../src/feedback.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("VoteeApiClient", () => {
  it("keeps the random seed and size in every request", async () => {
    const fetchFn = vi.fn<FetchLike>(async (input) => {
      const guess = new URL(String(input)).searchParams.get("guess");
      if (guess === null) throw new Error("Missing guess in test request");
      return jsonResponse(scoreGuess("wrote", guess));
    });
    const client = new VoteeApiClient({ fetchFn, retries: 0 });

    await client.guess({ mode: "random", seed: 42, size: 5 }, "raise");
    await client.guess({ mode: "random", seed: 42, size: 5 }, "wrote");

    const urls = fetchFn.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls.map((url) => url.pathname)).toEqual(["/random", "/random"]);
    expect(urls.map((url) => url.searchParams.get("seed"))).toEqual(["42", "42"]);
    expect(urls.map((url) => url.searchParams.get("size"))).toEqual(["5", "5"]);
    expect(urls.map((url) => url.searchParams.get("guess"))).toEqual(["raise", "wrote"]);
  });

  it.each([
    [{ mode: "daily", size: 5 } as const, "/daily?guess=raise&size=5"],
    [{ mode: "word", word: "apple" } as const, "/word/apple?guess=raise"],
  ])("builds the endpoint for %#", async (target, expected) => {
    const fetchFn = vi.fn<FetchLike>(async () => jsonResponse(scoreGuess("apple", "raise")));
    const client = new VoteeApiClient({ fetchFn, retries: 0 });

    await client.guess(target, "raise");

    const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(`${url.pathname}${url.search}`).toBe(expected);
  });

  it("sorts a valid response by slot", async () => {
    const reversed = scoreGuess("wrote", "raise").reverse();
    const client = new VoteeApiClient({
      fetchFn: async () => jsonResponse(reversed),
      retries: 0,
    });

    const result = await client.guess({ mode: "word", word: "wrote" }, "raise");

    expect(result.map(({ slot }) => slot)).toEqual([0, 1, 2, 3, 4]);
  });

  it("rejects malformed API payloads", async () => {
    const duplicateSlots = scoreGuess("wrote", "raise");
    duplicateSlots[1] = { ...duplicateSlots[1]!, slot: 0 };
    const client = new VoteeApiClient({
      fetchFn: async () => jsonResponse(duplicateSlots),
      retries: 0,
    });

    await expect(client.guess({ mode: "word", word: "wrote" }, "raise")).rejects.toThrow(
      /duplicate slots/,
    );
  });

  it("reports HTTP errors without retrying a client error", async () => {
    const fetchFn = vi.fn<FetchLike>(async () => jsonResponse({ detail: "bad guess" }, 422));
    const client = new VoteeApiClient({ fetchFn, retries: 2, retryDelayMs: 0 });

    await expect(client.guess({ mode: "word", word: "apple" }, "raise")).rejects.toMatchObject<
      Partial<VoteeApiError>
    >({ status: 422 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("validates guesses before calling the API", async () => {
    const fetchFn = vi.fn<FetchLike>();
    const client = new VoteeApiClient({ fetchFn, retries: 0 });

    await expect(client.guess({ mode: "random", seed: 1, size: 5 }, "four")).rejects.toThrow(
      /exactly 5/,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
