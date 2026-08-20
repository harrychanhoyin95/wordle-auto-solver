# Votee Wordle Auto-Solver

A TypeScript command-line solver for the
[Votee Wordle API](https://wordle.votee.dev:8000/redoc). It supports random,
daily, and user-selected puzzles while ensuring that every submitted guess is
a real word backed by a configured dictionary.

## Features

- random puzzles with one stable seed reused for the entire solve;
- the Votee daily puzzle;
- a user-selected target word for repeatable testing;
- exact feedback filtering, including Votee's duplicate-letter behavior;
- frequency-shortlisted partition minimax with deterministic tie-breaking;
- separate answer-candidate and exploratory-guess vocabularies;
- precomputed 26-bit letter-presence masks for faster scoring;
- local valid-word enforcement before every API request;
- response validation, request timeouts, and retries for transient failures;
- deterministic unit tests plus opt-in live API tests.

## Requirements

- Node.js 18 or newer
- npm

## Quick start

```bash
npm install
npm run solve -- random
```

Random mode generates one seed at startup and sends that same seed with every
guess. This matters because `/random` is stateless: changing or omitting the
seed between requests can select a different answer.

Use an explicit seed to replay a puzzle:

```bash
npm run solve -- random --seed 42
```

After a successful random solve, the CLI prints the reusable seed and answer.
For example, the regression seed for an answer outside the classic Wordle list
ends with:

```text
Random seed 2015760431 answer: JANET
```

## Usage

```bash
# Solve a random five-letter puzzle
npm run solve -- random

# Solve today's five-letter puzzle
npm run solve -- daily

# Solve a target selected by the user
npm run solve -- word apple

# Override the opener and enforce the traditional six-guess limit
npm run solve -- word apple --first crate --max-attempts 6

# Use another word length and dictionary
npm run solve -- random --size 6 --word-list ./my-six-letter-words.txt

# Show all CLI options
npm run solve -- --help
```

The default maximum is 12 requests. To run the compiled JavaScript instead of
`tsx`:

```bash
npm run build
npm start -- random --seed 42
```

### Modes

| Mode | Votee endpoint | Parameters kept constant during a solve |
| --- | --- | --- |
| `random` | `GET /random` | `size`, `seed` |
| `daily` | `GET /daily` | `size` |
| `word <answer>` | `GET /word/{word}` | selected target word |

Every request also sends the current `guess`. API responses are arrays of
`{ slot, guess, result }`, where `result` is `absent`, `present`, or `correct`.

### Options

| Option | Description |
| --- | --- |
| `--seed <integer>` | Stable puzzle seed; random mode only |
| `--size <integer>` | Word length for random or daily mode; default `5` |
| `--word-list <path>` | Custom whitespace-separated list used for both candidates and guesses |
| `--first <word>` | First guess; must be backed by a configured dictionary |
| `--max-attempts <n>` | Maximum API requests; default `12` |
| `--partition-budget <n>` | Approximate candidate/guess comparisons per hybrid selection; default `1500000` |
| `--base-url <url>` | Override the Votee API base URL |

## Solver strategy

1. Load, lowercase, de-duplicate, and length-filter two vocabularies. By
   default, `data/answers.txt` supplies 20,148 answer candidates and
   `data/words.txt` supplies 14,855 Wordle-valid exploratory guesses.
2. Precompute a 26-bit presence mask for every candidate and guess (`a`
   through `z` map to bits 0 through 25).
3. Start a five-letter puzzle with `RAISE` when it is available, unless
   `--first` is supplied. For other lengths, rank the opening guess with the
   same hybrid selector used later.
4. Submit the guess and validate the complete Votee response, including slots,
   echoed characters, and result values.
5. Locally reproduce that feedback for every remaining answer candidate and
   discard candidates whose full pattern differs.
6. Compute positional-letter and letter-presence frequencies across the
   remaining candidates. Rank all usable exploratory guesses with that cheap
   score, then retain an adaptive shortlist. Its base size is
   `max(512, floor(partitionBudget / candidates))`; remaining candidates that
   are also valid guesses are always retained.
7. Partition the candidates by the feedback pattern each shortlisted word
   would produce. Select the guess using these ordered criteria:
   - smallest largest bucket (minimize the worst case);
   - smallest sum of squared bucket sizes (improve the expected case);
   - prefer a remaining answer candidate;
   - alphabetical order for deterministic final ties.
   When 100 or fewer candidates remain, use the complete valid-guess pool for
   exact full-pool minimax instead of a shortlist.
8. Only when exactly one candidate remains, try that isolated answer directly,
   even when it is outside the narrower exploratory list. With two or more
   candidates, the hybrid choice must remain in the valid exploratory pool.
9. Repeat until every slot is `correct` or the attempt limit is reached.

With the current bundled lists, the selected target `APPLE` is solved in five
requests:

```text
RAISE -> ALANT -> GUMBO -> ADDLE -> APPLE
```

### Complexity

Mask construction is `O((A + G) x L)`, where `A` is the initial answer count,
`G` is the guess-pool size, and `L` is the word length. For `C` remaining
candidates, frequency ranking costs `O((C + G) x L + G log G)`. Exact
partition scoring then costs `O(K x C x L)`, where `K` is the adaptive
shortlist size and is at most `G`.

With the default budget and more than 100 candidates, `K` is approximately
`max(512, floor(1,500,000 / C))`, capped by the available guess pool. This
keeps the dominant `K x C` work near the configured budget until the 512-word
minimum takes over. At 100 or fewer candidates, `K = G`, so the late-game
worst case remains `O(G x C x L)`. The bitmask makes each letter-membership
check constant time; without it, pair scoring would be `O(L^2)`.

The implementation evaluates one guess at a time rather than storing the full
`G x C` score matrix.

## Valid-word enforcement

The solver does not use arbitrary strings as information probes. Hybrid probes
come only from `data/words.txt`, the classic Wordle-valid list. A broader
dictionary-backed answer candidate may be submitted only when filtering has
isolated it as the sole remaining candidate. The solver checks every guess
against the union of these configured dictionaries immediately before calling
the API. This also covers the default opener and a user-provided `--first`
value; an unsupported first guess fails locally without sending a request.

When `--word-list` is supplied, that custom file replaces both bundled lists
and becomes the answer-candidate and valid-guess authority.

## Votee feedback semantics

The local scorer intentionally matches the Votee service rather than standard
Wordle duplicate-count rules. Votee marks a misplaced character as `present`
whenever that character exists anywhere in the target; duplicate occurrences
are not consumed. For example, `ALLEE` against `APPLE` produces:

```text
correct, present, present, present, correct
```

Matching these semantics is essential: a conventional Wordle filter could
remove the actual answer after duplicate-letter feedback.

## Limitations

- The answer must be present in the configured answer-candidate list.
- `data/answers.txt` deliberately includes a broader English dictionary than
  the exploratory list, so candidates can include uncommon words and names
  such as `JANET`.
- The Votee API exposes no vocabulary-list or answer-disclosure endpoint.
  Combining the classic Wordle list with a broader English dictionary reduces
  unknown-vocabulary failures, but cannot mathematically eliminate them.
- The hybrid strategy optimizes the shortlisted partitions but does **not** prove a
  universal six-guess guarantee. Such a guarantee would require the exact
  server answer vocabulary and exhaustive evaluation of every answer.
- Live behavior depends on the availability and contract of the Votee service.

## Tests

Run the deterministic unit tests:

```bash
npm test
```

Compile TypeScript and run the unit tests:

```bash
npm run check
```

Run the opt-in live integration tests (these make real HTTP requests):

```bash
npm run test:live
```

Compare the production hybrid strategy against an exhaustive full-pool minimax
baseline without making network requests:

```bash
npm run benchmark -- --sample 30 --seed 20260820 --max-attempts 6 --budget 1500000
```

The benchmark uses the complete bundled dictionaries for every simulated solve,
while the deterministic sample controls which answers are measured. It reports
selector CPU time, attempt distribution, six-attempt solve rate, shortlist size,
and per-answer quality regressions. The benchmark imports the production
shortlist implementation directly so its hybrid path cannot drift from runtime.

The deterministic suite contains 94 tests covering feedback and
duplicate-letter combinations, separate candidate/guess pools, minimax
and hybrid selection, 26-bit masks, all three API modes, stable-seed reuse, custom options
and dictionaries, strict guess allowlisting, malformed responses, HTTP
failures, and attempt limits. This includes 50 production-readiness cases
written independently across ten focused test suites. Three opt-in live tests
cover Votee's duplicate behavior, seed 42, and the seed `2015760431` `JANET`
regression.

## Project layout

```text
src/api.ts          Typed Votee client, retries, and response validation
src/feedback.ts     Votee-compatible scoring, pattern keys, and bitmasks
src/solver.ts       Candidate filtering, hybrid selection, and solve loop
src/word-list.ts    Bundled or custom dictionary loading
src/cli-options.ts  Command-line parsing and validation
src/cli.ts          Terminal entry point
scripts/            Offline full-minimax versus hybrid benchmark
test/               Unit and opt-in live integration tests
data/answers.txt    Broader bundled five-letter answer-candidate list
data/words.txt      Classic Wordle-valid exploratory guess list
third_party/        Third-party license notices
```

## Third-party attribution

The bundled `data/words.txt` comes from Tab Atkins Jr.'s
[tabatkins/wordle-list](https://github.com/tabatkins/wordle-list), distributed
under the MIT License. Its copyright and license notice is preserved in
[`third_party/tabatkins-wordle-list-LICENSE`](third_party/tabatkins-wordle-list-LICENSE).

The bundled `data/answers.txt` is the union of that list and the five-letter
entries from [dwyl/english-words](https://github.com/dwyl/english-words), which
is dedicated to the public domain under the Unlicense. Its notice is preserved
in
[`third_party/dwyl-english-words-UNLICENSE.md`](third_party/dwyl-english-words-UNLICENSE.md).
