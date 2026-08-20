import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const bundledWordListPath = fileURLToPath(new URL("../data/words.txt", import.meta.url));
const bundledAnswerListPath = fileURLToPath(new URL("../data/answers.txt", import.meta.url));

export interface LoadWordListOptions {
  readonly size: number;
  readonly path?: string;
}

export async function loadWordList(options: LoadWordListOptions): Promise<string[]> {
  const path = options.path ?? bundledWordListPath;
  return loadWords(path, options.size);
}

export async function loadAnswerList(options: LoadWordListOptions): Promise<string[]> {
  const path = options.path ?? bundledAnswerListPath;
  return loadWords(path, options.size);
}

async function loadWords(path: string, size: number): Promise<string[]> {
  const text = await readFile(path, "utf8");
  const wordPattern = new RegExp(`^[a-z]{${size}}$`);
  const words = [
    ...new Set(
      text
        .split(/\s+/)
        .map((word) => word.trim().toLowerCase())
        .filter((word) => wordPattern.test(word)),
    ),
  ];

  if (words.length === 0) {
    throw new Error(`No ${size}-letter words were found in ${path}.`);
  }

  return words;
}
