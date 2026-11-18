/**
 * A build's command, as argv on the wire and as text in the database — and the one exact
 * conversion between the two.
 *
 * AH.4 ([#252](https://github.com/NobuData/ouroboros/issues/252)). The protocol's `job.offer.command`
 * is **argv, never a shell string** (`docs/RUNNER_PROTOCOL.md` § 4.3): *a quoted path that a
 * splitter gets wrong is a build that fails for a reason nobody can see.* The API takes argv for
 * the same reason. But V040's `build_jobs.command` is text — the runners table and the live card
 * print it, and CD.3's (#561) similarity classing reads it — and V043's `runner_pools.default_command`
 * is text in the same form, so a fallback copies it unchanged.
 *
 * So the text is the argv's **canonical rendering**, and this file is its only reader and
 * writer:
 *
 * ```
 * ["west", "build", "-b", "helios_mainboard", "app"]  ⇄  west build -b helios_mainboard app
 * ["sh", "-c", "make all"]                            ⇄  sh -c 'make all'
 * ["echo", "it's"]                                    ⇄  echo 'it'\''s'
 * ["printf", ""]                                      ⇄  printf ''
 * ```
 *
 * A word made only of characters no POSIX shell treats specially is written bare; any other is
 * single-quoted, with an embedded `'` written `'\''`. That is the form a person can paste into a
 * terminal and get the same argv, which is why it is the form worth storing.
 *
 * **{@link parseCommand} is the exact inverse of {@link renderCommand}, and nothing more.** It
 * reads a text back into argv only when rendering that argv reproduces the text byte for byte;
 * anything else — double quotes, a `$`, two spaces, a trailing backslash — is refused with
 * `undefined` rather than interpreted. Nothing a user typed as a string is ever split into words,
 * because the API never accepts a string command: the only texts this reads are ones this file
 * wrote, or the seed's plain-word commands, which are their own rendering.
 */

/** The characters a word may consist of and still be written bare. */
const BARE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * Render one argument.
 *
 * @param word - The argument.
 * @returns It bare when it is plain, single-quoted otherwise.
 */
function renderWord(word: string): string {
  if (BARE.test(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * Render argv as the text `build_jobs.command` and `runner_pools.default_command` hold.
 *
 * @param argv - The command. At least one word; the first is the program.
 * @returns The canonical rendering: words joined by single spaces.
 * @throws {TypeError} If argv is empty — there is no text for a command with no program.
 */
export function renderCommand(argv: readonly string[]): string {
  if (argv.length === 0) throw new TypeError("a command has at least one word");
  return argv.map(renderWord).join(" ");
}

/**
 * Read a stored command back into argv.
 *
 * @param text - `build_jobs.command` or `runner_pools.default_command`.
 * @returns The argv, or `undefined` when the text is not a canonical rendering — which a
 *   caller treats as a record it cannot dispatch, never as something to guess at.
 */
export function parseCommand(text: string): string[] | undefined {
  const words: string[] = [];
  let word = "";
  let started = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (char === " ") {
      if (!started) return undefined;
      words.push(word);
      word = "";
      started = false;
      index += 1;
    } else if (char === "'") {
      const close = text.indexOf("'", index + 1);
      if (close < 0) return undefined;
      word += text.slice(index + 1, close);
      started = true;
      index = close + 1;
    } else if (char === "\\" && text[index + 1] === "'") {
      word += "'";
      started = true;
      index += 2;
    } else {
      word += char;
      started = true;
      index += 1;
    }
  }

  if (!started) return undefined;
  words.push(word);

  // The inverse, held to its definition: only a text this renderer would have written is read.
  return renderCommand(words) === text ? words : undefined;
}

/** Where a build's command came from, and its text. */
export interface ResolvedBuildCommand {
  /** `stage` — the request named one; `pool` — the pool's `default_command` stood in. */
  readonly source: "stage" | "pool";
  /** The command: the request's own text, or the pool's stored rendering. */
  readonly text: string;
}

/**
 * Resolve the command a build runs — **the one rule dispatch and the loop readiness check share**
 * (FE.3, [#1836](https://github.com/NobuData/ouroboros/issues/1836)).
 *
 * ```
 * the stage's (or request's) command → the pool's default_command → none (farm_command_required)
 * ```
 *
 * A pool default stands in only when {@link parseCommand} can read it back into argv: a stored
 * text this file did not write is one dispatch cannot send, so it counts as no default at all.
 *
 * @param requested - The command the stage or request names — the DSL's `config.command`, or the
 *   rendering of the API's argv — or `null`/`undefined`/`""` when it names none.
 * @param poolDefault - The pool's `runner_pools.default_command`, or `null` when it has none or
 *   the pool is not known.
 * @returns The command and its source, or `undefined` when neither supplies one — the case
 *   dispatch refuses `422 farm_command_required`.
 */
export function resolveBuildCommand(
  requested: string | null | undefined,
  poolDefault: string | null,
): ResolvedBuildCommand | undefined {
  if (requested !== null && requested !== undefined && requested !== "") {
    return { source: "stage", text: requested };
  }
  if (poolDefault !== null && parseCommand(poolDefault) !== undefined) {
    return { source: "pool", text: poolDefault };
  }

  return undefined;
}
