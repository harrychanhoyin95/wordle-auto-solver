import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAnswerList, loadWordList } from "../src/word-list.js";

describe("loadWordList", () => {
  it("normalizes, filters by size, and de-duplicates words", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordle-list-"));
    const path = join(directory, "words.txt");
    await writeFile(path, "APPLE apple pear can't RAISE\n", "utf8");

    await expect(loadWordList({ path, size: 5 })).resolves.toEqual(["apple", "raise"]);
  });

  it("fails when no words match the requested size", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordle-list-"));
    const path = join(directory, "words.txt");
    await writeFile(path, "one two", "utf8");

    await expect(loadWordList({ path, size: 5 })).rejects.toThrow(/No 5-letter words/);
  });

  it("bundles the API-only JANET answer separately from Wordle-valid guesses", async () => {
    const [answers, guesses] = await Promise.all([
      loadAnswerList({ size: 5 }),
      loadWordList({ size: 5 }),
    ]);

    expect(answers).toContain("janet");
    expect(guesses).not.toContain("janet");
  });
});
