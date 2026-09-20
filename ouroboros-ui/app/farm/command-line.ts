/**
 * A build's command, as the words a person types and the argv the API takes
 * (AI.5, [#260](https://github.com/NobuData/ouroboros/issues/260)).
 *
 * `POST /api/v1/farm/jobs` takes **argv, never a shell string**, and says why: *a quoted path
 * that a splitter gets wrong is a build that fails for a reason nobody can see* — so *a client
 * that has a string must split it itself, where the person who wrote it can see the result*
 * (`ouroboros-rest`'s `dispatch/jobs.dto.ts`). This module is that split, and the submit dialog
 * draws its result under the field for exactly that reason.
 *
 * ### One grammar, the service's
 *
 * A pool's `defaultCommand` arrives as the **canonical rendering** of an argv
 * (`dispatch/command.ts`): plain words bare, any other word single-quoted, an embedded `'`
 * written `'\''`. {@link renderCommandLine} writes that form and {@link parseCommandLine} reads
 * it, so the prefilled default round-trips to exactly the argv the service would fall back to.
 *
 * The reader is a little more forgiving than the service's — a person types, so runs of spaces
 * separate words and a word may mix bare and quoted parts (`--define='a b'`) — and **no more
 * than that**. Double quotes, `$`, a backslash, a glob: each means something to a shell and
 * nothing here, and guessing which the person meant is the failure the API's rule exists to
 * prevent. They are refused with a sentence that names the character and the way out.
 *
 * **Framework-free and pure**, as `app/farm/view.ts` is.
 */

/** The characters a word may consist of and still be written bare — `dispatch/command.ts`'s. */
const BARE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** One character {@link BARE} admits. */
const BARE_CHARACTER = /[A-Za-z0-9_@%+=:,./-]/;

/** What separates two words. */
const BLANK = /[ \t]/;

/** What a command line reads as: the words, or the sentence that says why it has none. */
export type ParsedCommandLine =
  | { readonly ok: true; readonly argv: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/** What an unclosed `'` is told. */
export const UNCLOSED_QUOTE = "A single quote is opened and never closed.";

/**
 * What a character outside the grammar is told.
 *
 * @param character The character.
 * @returns The sentence: what is wrong, why, and what to type instead.
 */
export function unquotedCharacter(character: string): string {
  return (
    `“${character}” means something to a shell, and this command is sent as words rather ` +
    "than run through one. Put the word in single quotes."
  );
}

/**
 * Render one argument.
 *
 * @param word The argument.
 * @returns It bare when it is plain, single-quoted otherwise.
 */
function renderWord(word: string): string {
  return BARE.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * Render argv the way the service stores a command.
 *
 * @param argv The words.
 * @returns The canonical rendering — words joined by single spaces — or `""` for no words.
 */
export function renderCommandLine(argv: readonly string[]): string {
  return argv.map(renderWord).join(" ");
}

/**
 * Read a command line into argv.
 *
 * @param text What the person typed.
 * @returns The words — **none** for a blank line, which is a command left to the pool's default
 *   and not an error — or the reason the line cannot be read. Nothing is ever guessed.
 */
export function parseCommandLine(text: string): ParsedCommandLine {
  const argv: string[] = [];
  let word: string | null = null;
  let at = 0;

  while (at < text.length) {
    const character = text[at];

    if (BLANK.test(character)) {
      if (word !== null) argv.push(word);
      word = null;
      at += 1;
    } else if (character === "'") {
      const close = text.indexOf("'", at + 1);
      if (close === -1) return { ok: false, reason: UNCLOSED_QUOTE };

      // Everything between the quotes is literal — that is the whole point of them.
      word = (word ?? "") + text.slice(at + 1, close);
      at = close + 1;
    } else if (character === "\\" && text[at + 1] === "'") {
      // The one escape: `'\''` is how the canonical form writes a quote inside a quoted word.
      word = `${word ?? ""}'`;
      at += 2;
    } else if (BARE_CHARACTER.test(character)) {
      word = (word ?? "") + character;
      at += 1;
    } else {
      return { ok: false, reason: unquotedCharacter(character) };
    }
  }

  if (word !== null) argv.push(word);

  return { ok: true, argv };
}
