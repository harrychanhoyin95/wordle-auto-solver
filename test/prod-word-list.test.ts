import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAnswerList, loadWordList } from "../src/word-list.js";

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "wordle-prod-list-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("production word-list boundaries", () => {
  it("loads 20,148 bundled answers separately from 14,855 attributed valid guesses", async () => {
    const [answers, guesses] = await Promise.all([
      loadAnswerList({ size: 5 }),
      loadWordList({ size: 5 }),
    ]);
    const answerSet = new Set(answers);

    expect(answers).toHaveLength(20_148);
    expect(guesses).toHaveLength(14_855);
    expect(answerSet.size).toBe(20_148);
    expect(new Set(guesses).size).toBe(14_855);
    expect(guesses.every((word) => answerSet.has(word))).toBe(true);
    expect(answers.length - guesses.length).toBe(5_293);
  });

  it("retains JANET as a broader answer candidate without admitting it as a valid probe", async () => {
    const [answers, guesses] = await Promise.all([
      loadAnswerList({ size: 5 }),
      loadWordList({ size: 5 }),
    ]);

    expect(answers).toContain("janet");
    expect(guesses).not.toContain("janet");
    expect(answers.indexOf("janet")).toBeGreaterThanOrEqual(0);
    expect(guesses.indexOf("janet")).toBe(-1);
  });

  it("normalizes CRLF and surrounding whitespace while filtering and de-duplicating custom lists", async () => {
    const directory = await makeTemporaryDirectory();
    const path = join(directory, "custom-words.txt");
    await writeFile(
      path,
      "  APPLE\r\nraise\tAPPLE  \r\npears\r\nFOUR\r\ncan't\r\nnaive!\r\n",
      "utf8",
    );

    const [answers, guesses] = await Promise.all([
      loadAnswerList({ path, size: 5 }),
      loadWordList({ path, size: 5 }),
    ]);

    expect(answers).toEqual(["apple", "raise", "pears"]);
    expect(guesses).toEqual(["apple", "raise", "pears"]);
  });

  it("rejects missing, unreadable, and empty matching custom-list inputs", async () => {
    const directory = await makeTemporaryDirectory();
    const missingPath = join(directory, "missing.txt");
    const unreadableAsFilePath = join(directory, "words-directory");
    const noMatchesPath = join(directory, "no-five-letter-words.txt");
    await mkdir(unreadableAsFilePath);
    await writeFile(noMatchesPath, "\r\n one\ttwo \r\n can't 12345\r\n", "utf8");

    await expect(loadWordList({ path: missingPath, size: 5 })).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      loadAnswerList({ path: unreadableAsFilePath, size: 5 }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^(EACCES|EISDIR|EPERM)$/),
    });
    await expect(loadWordList({ path: noMatchesPath, size: 5 })).rejects.toThrow(
      `No 5-letter words were found in ${noMatchesPath}.`,
    );
  });

  it("returns deterministic fresh arrays whose mutation cannot alter later bundled loads", async () => {
    const [firstAnswers, firstGuesses] = await Promise.all([
      loadAnswerList({ size: 5 }),
      loadWordList({ size: 5 }),
    ]);
    const expectedAnswerPrefix = firstAnswers.slice(0, 25);
    const expectedGuessPrefix = firstGuesses.slice(0, 25);

    firstAnswers.splice(0, firstAnswers.length, "xxxxx");
    firstGuesses.splice(0, firstGuesses.length, "yyyyy");

    const [secondAnswers, secondGuesses, parallelAnswers, parallelGuesses] = await Promise.all([
      loadAnswerList({ size: 5 }),
      loadWordList({ size: 5 }),
      loadAnswerList({ size: 5 }),
      loadWordList({ size: 5 }),
    ]);

    expect(secondAnswers).not.toBe(parallelAnswers);
    expect(secondGuesses).not.toBe(parallelGuesses);
    expect(secondAnswers).toEqual(parallelAnswers);
    expect(secondGuesses).toEqual(parallelGuesses);
    expect(secondAnswers.slice(0, 25)).toEqual(expectedAnswerPrefix);
    expect(secondGuesses.slice(0, 25)).toEqual(expectedGuessPrefix);
    expect(secondAnswers).toHaveLength(20_148);
    expect(secondGuesses).toHaveLength(14_855);
  });
});
