import { describe, expect, it } from "vitest";

import {
  UNCLOSED_QUOTE,
  parseCommandLine,
  renderCommandLine,
  unquotedCharacter,
} from "@/app/farm/command-line";

/**
 * A build's command, between the words a person types and the argv the API takes (#260).
 *
 * The API refuses a shell string because *a quoted path that a splitter gets wrong is a build
 * that fails for a reason nobody can see*. So what is held here is that the split is the
 * service's own grammar, that it round-trips a pool's default command exactly, and that anything
 * outside the grammar is **refused with a sentence rather than guessed at**.
 */

/**
 * The words a line reads as.
 *
 * @param text The line.
 * @returns The argv, or the reason there is none.
 */
function words(text: string): readonly string[] | string {
  const parsed = parseCommandLine(text);

  return parsed.ok ? parsed.argv : parsed.reason;
}

describe("reading a command line", () => {
  it("splits plain words on spaces — the seeded pool's default", () => {
    expect(words("west build -b helios_mainboard app")).toEqual([
      "west",
      "build",
      "-b",
      "helios_mainboard",
      "app",
    ]);
  });

  it("keeps a single-quoted word whole, spaces and all", () => {
    expect(words("sh -c 'make all'")).toEqual(["sh", "-c", "make all"]);
  });

  it("reads the canonical form's embedded quote", () => {
    // `dispatch/command.ts` writes `it's` as `'it'\''s'`: close, an escaped quote, reopen.
    expect(words("echo 'it'\\''s'")).toEqual(["echo", "it's"]);
  });

  it("keeps an empty quoted word, which `printf ''` has every right to pass", () => {
    expect(words("printf ''")).toEqual(["printf", ""]);
  });

  it("joins bare and quoted parts of one word", () => {
    expect(words("cmake --define='a b' .")).toEqual(["cmake", "--define=a b", "."]);
  });

  it("is forgiving about the spaces a person types, and about nothing else", () => {
    expect(words("  make   all\t")).toEqual(["make", "all"]);
  });

  it("reads a blank line as no command at all, not as an error", () => {
    // A command left blank is one left to the pool's default; saying so is `submit.ts`'s.
    expect(words("")).toEqual([]);
    expect(words("   ")).toEqual([]);
  });

  it("takes what a shell would expand literally once it is quoted", () => {
    expect(words("sh -c 'echo $HOME && ls *.c'")).toEqual(["sh", "-c", "echo $HOME && ls *.c"]);
  });
});

describe("refusing what it cannot read", () => {
  it.each([
    ['sh -c "make all"', '"'],
    ["echo $HOME", "$"],
    ["ls *.c", "*"],
    ["make && make test", "&"],
    ["echo a\\ b", "\\"],
    ["make; rm -rf build", ";"],
    ["echo `date`", "`"],
    ["cat < in.txt", "<"],
    ["make | tee log", "|"],
  ])("refuses %s, naming the character", (text, character) => {
    // Each of these means something to a shell and nothing here. Guessing which the person
    // meant is exactly the failure the API's argv rule exists to prevent.
    expect(words(text)).toBe(unquotedCharacter(character));
  });

  it("says what to do about it", () => {
    expect(unquotedCharacter("$")).toContain("single quotes");
    expect(unquotedCharacter("$")).toContain("$");
  });

  it("refuses a quote that is never closed", () => {
    expect(words("sh -c 'make all")).toBe(UNCLOSED_QUOTE);
  });

  it("does not take a lone backslash as an escape", () => {
    expect(words("echo \\")).toBe(unquotedCharacter("\\"));
  });
});

describe("writing a command line", () => {
  it.each([
    [["west", "build", "-b", "helios_mainboard", "app"], "west build -b helios_mainboard app"],
    [["sh", "-c", "make all"], "sh -c 'make all'"],
    [["echo", "it's"], "echo 'it'\\''s'"],
    [["printf", ""], "printf ''"],
  ])("renders %j the way the service stores it", (argv, text) => {
    // `dispatch/command.ts`'s own four examples — the form a pool's `defaultCommand` arrives in.
    expect(renderCommandLine(argv)).toBe(text);
  });

  it("renders no words as no text", () => {
    expect(renderCommandLine([])).toBe("");
  });

  it.each([
    [["west", "build", "-b", "helios_mainboard", "app"]],
    [["sh", "-c", "echo 'quoted' && ls *.c"]],
    [["printf", "", "%s\\n"]],
    [["a b", "c'd", "e\"f", "$g"]],
  ])("round-trips %j exactly", (argv) => {
    // The property the prefill depends on: a default the dialog shows and the reader submits
    // untouched reads back as the argv the service would have fallen back to.
    expect(words(renderCommandLine(argv))).toEqual(argv);
  });
});
