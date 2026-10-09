/**
 * The configuration reference, read out of the root `.env.example` and written as MDX (DB.3).
 *
 * `.env.example` is the complete list of the variables Ouroboros reads (ARCHITECTURE.md § 6.1,
 * rule 4), and every variable in it sits under the comment that explains it. This module turns
 * that file into the site's reference so the two cannot drift: {@link parseEnvExample} reads it
 * into sections and variables, and {@link renderReference} writes them as the MDX partial
 * `docs/administration/configuration/_generated.mdx`. `scripts/gen-config-reference.ts` is the
 * command that runs the two; this module is pure, so the tests drive it with small inputs.
 *
 * ### How the file is read
 *
 * - A **section** starts at a header — a `# ---` rule, a `# Title` line and another rule. The
 *   title names the service the variables below it belong to.
 * - A **comment block** is a run of `#` lines. A line holding only `#` breaks it into
 *   paragraphs; a line indented by three or more spaces after the `#` is a code line.
 * - A **variable** is one of three things, and the block directly above it is its description:
 *   - `NAME=value` — set in the template; `value` is the development default;
 *   - `# NAME=value` as the last line of a block — unset by default, `value` is an example;
 *   - `#   NAME=value` (indented) as the last line of a block, for a name set nowhere else in
 *     the file — likewise unset, with that example. An indented line anywhere else is just an
 *     example inside the prose.
 * - A variable with no block of its own directly above it (the second of a pair written one
 *   after the other) shares the description of the variable before it.
 * - A block followed by anything but a variable describes the file, not a variable, and is
 *   not part of the reference.
 *
 * ### What the reference leaves out
 *
 * The template's comments are written for engineers and cite the issues and roadmap decisions
 * behind each variable. The site does not: {@link stripReferences} removes every parenthetical
 * that cites one, and {@link renderReference} refuses a description that still names an issue,
 * so a new comment that cites one outside parentheses fails the generator, naming the
 * variable, rather than reaching a reader.
 */

/** One variable of the reference. */
export interface ConfigVariable {
  /** The name, exactly as the template spells it — `OURO_SMTP_URL`. */
  readonly name: string;
  /**
   * How the template declares it: `set` for a live assignment, `unset` for one the template
   * leaves commented out or shows only as an example.
   */
  readonly state: "set" | "unset";
  /** The template's value: the development default when `set`, an example when `unset`. */
  readonly value: string;
  /** Whether the value is a `…-change-me` placeholder, which `yarn setup` replaces with a secret. */
  readonly secret: boolean;
  /** The description, as paragraphs; a code paragraph's lines are kept as written. */
  readonly paragraphs: readonly Paragraph[];
  /** The variable whose description this one shares, when it has none of its own. */
  readonly sharesWith?: string;
}

/** One paragraph of a description. */
export interface Paragraph {
  /** `text` is prose, joined into one line; `code` keeps its lines. */
  readonly kind: "text" | "code";
  /** The prose, or the code's lines joined by newlines. */
  readonly body: string;
}

/** One section of the template — the variables under one header. */
export interface ConfigSection {
  /** The header's title, e.g. `Mail and the weekly Insights digest — ouroboros-rest`. */
  readonly title: string;
  /** The variables, in the template's order. */
  readonly variables: readonly ConfigVariable[];
}

/** A variable name: upper case, digits and underscores, starting with a letter. */
const NAME = "[A-Z][A-Z0-9_]*";

/** A live assignment: `NAME=value`. */
const ASSIGNMENT = new RegExp(`^(${NAME})=(.*)$`);

/** A commented-out assignment: `# NAME=value`, one space after the `#`. */
const COMMENTED_ASSIGNMENT = new RegExp(`^# (${NAME})=(.*)$`);

/** An example assignment on a code line: `#   NAME=value`. */
const EXAMPLE_ASSIGNMENT = new RegExp(`^#\\s{3,}(${NAME})=(\\S*)$`);

/** A section header's rule line. */
const RULE = /^# -{10,}$/;

/** A code line: three or more spaces after the `#`. */
const CODE_LINE = /^#\s{3,}/;

/** The suffix the templates mark a generated secret with — `scripts/setup.sh` replaces it. */
const SECRET_SUFFIX = "-change-me";

/**
 * A parenthetical that cites an issue (`#330`), a roadmap item (`BR.5`, `AL.5`) or a roadmap
 * decision (`decision B3`). The parenthetical may span what were several comment lines, which
 * {@link parseEnvExample} has already joined.
 */
const CITING_PARENTHETICAL =
  /\s*\((?:[^()]*?)(?:#\d+|\b[A-Z]{1,2}\.\d+\b|\bdecision [A-Z]+\d+\b)[^()]*\)/g;

/** What a description may not contain once its parentheticals are gone. */
const CITATION = /#\d+|\b[A-Z]{1,2}\.\d+\b|\bdecision [A-Z]+\d+\b/;

/**
 * Removes the parentheticals that cite issues, roadmap items or decisions.
 *
 * @param text one paragraph of prose.
 * @returns the prose without them, e.g. `The header (issue #250, decision B3).` → `The header.`
 */
export function stripReferences(text: string): string {
  // The pattern takes the space before the parenthetical with it, so `header (#250).` loses
  // both and keeps its full stop; nothing else in the paragraph is touched.
  return text.replace(CITING_PARENTHETICAL, "");
}

/**
 * Splits a comment block into paragraphs.
 *
 * @param lines the block's lines, each starting with `#`.
 * @returns its paragraphs: prose joined into one line, code lines kept with their indent
 *   relative to the shallowest code line.
 */
function paragraphsOf(lines: readonly string[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let text: string[] = [];
  let code: string[] = [];

  const flush = (): void => {
    if (text.length > 0) paragraphs.push({ kind: "text", body: stripReferences(text.join(" ")) });
    if (code.length > 0) {
      const indent = Math.min(...code.map((line) => /^\s*/.exec(line)?.[0].length ?? 0));
      paragraphs.push({ kind: "code", body: code.map((line) => line.slice(indent)).join("\n") });
    }
    text = [];
    code = [];
  };

  for (const line of lines) {
    if (line.trim() === "#") {
      flush();
    } else if (CODE_LINE.test(line)) {
      if (text.length > 0) flush();
      code.push(line.slice(1));
    } else {
      if (code.length > 0) flush();
      text.push(line.replace(/^#\s?/, "").trim());
    }
  }
  flush();
  return paragraphs;
}

/**
 * Reads the template into its sections.
 *
 * @param source the text of `.env.example`.
 * @returns the sections that declare at least one variable, in the file's order.
 * @throws {Error} when a variable is declared twice, or a variable appears before any section.
 */
export function parseEnvExample(source: string): ConfigSection[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const liveNames = new Set(
    lines.map((line) => ASSIGNMENT.exec(line)?.[1]).filter((name) => name !== undefined),
  );

  const sections: { title: string; variables: ConfigVariable[] }[] = [];
  const seen = new Set<string>();
  /** The comment lines read since the last blank line, variable or header. */
  let block: string[] = [];
  /** The variable read last in this run, which a block-less variable shares its text with. */
  let previous: ConfigVariable | undefined;

  const add = (variable: ConfigVariable, line: number): void => {
    const section = sections.at(-1);
    if (section === undefined) {
      throw new Error(`.env.example line ${line}: ${variable.name} is declared before any section`);
    }
    if (seen.has(variable.name)) {
      throw new Error(`.env.example line ${line}: ${variable.name} is declared twice`);
    }
    seen.add(variable.name);
    section.variables.push(variable);
    previous = variable;
  };

  const declare = (name: string, state: "set" | "unset", value: string, line: number): void => {
    const own = block.length > 0;
    add(
      {
        name,
        state,
        value,
        secret: value.endsWith(SECRET_SUFFIX),
        paragraphs: own ? paragraphsOf(block) : (previous?.paragraphs ?? []),
        ...(own || previous === undefined
          ? {}
          : { sharesWith: previous.sharesWith ?? previous.name }),
      },
      line,
    );
    block = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const number = index + 1;
    const next = lines[index + 1] ?? "";
    const endsBlock = !next.startsWith("#") || RULE.test(next);

    if (RULE.test(line) && RULE.test(lines[index + 2] ?? "")) {
      sections.push({
        title: stripReferences(lines[index + 1].replace(/^#\s*/, "")),
        variables: [],
      });
      block = [];
      previous = undefined;
      index += 2;
      continue;
    }

    const live = ASSIGNMENT.exec(line);
    if (live) {
      declare(live[1], "set", live[2], number);
      continue;
    }

    if (line.trim() === "") {
      // A blank line ends a run: a block above it described the file, not a variable.
      block = [];
      previous = undefined;
      continue;
    }

    const commented = COMMENTED_ASSIGNMENT.exec(line);
    const example = EXAMPLE_ASSIGNMENT.exec(line);
    if (endsBlock && commented) {
      declare(commented[1], "unset", commented[2], number);
      continue;
    }
    if (endsBlock && example && !liveNames.has(example[1]) && !seen.has(example[1])) {
      // Drop the `#` line that separated the example from the prose above it.
      while (block.at(-1)?.trim() === "#") block.pop();
      declare(example[1], "unset", example[2], number);
      continue;
    }

    block.push(line);
  }

  return sections.filter((section) => section.variables.length > 0);
}

/**
 * Escapes prose for MDX outside code spans: `{`, `}` and `<` would otherwise open an
 * expression or a tag, and a bare address is set as code rather than left for autolinking.
 *
 * @param text one paragraph of prose.
 * @returns the paragraph, with backtick code spans left as written.
 */
export function escapeMdx(text: string): string {
  /** Applies `edit` to the parts of `value` outside backtick code spans. */
  const outsideCode = (value: string, edit: (prose: string) => string): string =>
    value
      .split(/(`[^`]*`)/)
      .map((part) => (/^`[^`]*`$/.test(part) ? part : edit(part)))
      .join("");

  // Addresses become code spans first, which MDX and markdownlint both leave alone; then
  // what is still prose is escaped.
  const coded = outsideCode(text, (prose) => prose.replace(BARE_URL, (url) => `\`${url}\``));
  return outsideCode(coded, (prose) =>
    prose.replace(/[{}]/g, (brace) => `\\${brace}`).replace(/</g, "&lt;"),
  );
}

/**
 * The anchor of a variable's entry — what `<EnvVar>` links to.
 *
 * @param name the variable's name.
 * @returns its name in lower case, e.g. `ouro_smtp_url`.
 */
export function anchorOf(name: string): string {
  return name.toLowerCase();
}

/**
 * Wraps a value in a code span that survives backticks inside it.
 *
 * @param value the value.
 * @returns a Markdown code span.
 */
function codeSpan(value: string): string {
  const fence = value.includes("`") ? "``" : "`";
  return `${fence}${value}${fence}`;
}

/**
 * The line that says what the template sets a variable to.
 *
 * @param variable the variable.
 * @returns e.g. ``**Development default:** `15` ``.
 */
function valueLine(variable: ConfigVariable): string {
  if (variable.secret) return "**Development default:** a secret, generated by `yarn setup`.";
  if (variable.state === "unset") {
    return variable.value === ""
      ? "**Development default:** unset."
      : `**Development default:** unset. Example: ${codeSpan(variable.value)}`;
  }
  return variable.value === ""
    ? "**Development default:** empty."
    : `**Development default:** ${codeSpan(variable.value)}`;
}

/**
 * The generated file's opening: the do-not-edit notice, as an MDX comment.
 *
 * It is a comment and not front matter on purpose. The file is an MDX *partial* — its name
 * starts with `_`, and `configuration/index.mdx` imports it — and Docusaurus ignores a
 * partial's front matter: a warning in a local build, but **an error under `CI`**, which is
 * what failed `ci/docs` on every merge from #1191 until this was caught. markdownlint's
 * first-heading rule, which the old front matter's `title` satisfied, now skips partials
 * (`.markdownlint-cli2.jsonc`): a partial is a fragment of the page that imports it, not a
 * page.
 */
export const GENERATED_NOTICE = [
  "{/* Generated from the root .env.example by scripts/gen-config-reference.ts — do not edit.",
  "    Run `yarn gen:config-reference` in ouroboros-docs after changing .env.example. */}",
].join("\n");

/** A bare address in prose, without the punctuation that may end its sentence. */
const BARE_URL = /\bhttps?:\/\/[^\s`]*[^\s`.,;:)]/g;

/**
 * Writes the reference as MDX: a `##` heading per section and a `###` heading per variable,
 * which Docusaurus gives the id {@link anchorOf} its name.
 *
 * @param sections what {@link parseEnvExample} read.
 * @returns the text of `_generated.mdx`, ending in one newline.
 * @throws {Error} naming the variable when its description still cites an issue, a roadmap item
 *   or a decision after {@link stripReferences} — reword that comment in `.env.example`.
 */
export function renderReference(sections: readonly ConfigSection[]): string {
  const out: string[] = [GENERATED_NOTICE, ""];

  for (const section of sections) {
    out.push(`## ${escapeMdx(section.title)}`, "");
    for (const variable of section.variables) {
      // No explicit id: the site's MDX has none (future.v4), and the id Docusaurus derives from
      // a heading that is only the name in code is the name in lower case — anchorOf().
      out.push(`### \`${variable.name}\``, "");
      out.push(valueLine(variable), "");

      if (variable.sharesWith !== undefined) {
        out.push(
          `Described with [\`${variable.sharesWith}\`](#${anchorOf(variable.sharesWith)}) above.`,
          "",
        );
        continue;
      }
      for (const paragraph of variable.paragraphs) {
        if (paragraph.kind === "code") {
          out.push("```text", paragraph.body, "```", "");
          continue;
        }
        if (CITATION.test(paragraph.body)) {
          throw new Error(
            `${variable.name}: its comment in .env.example still cites an issue or decision ` +
              `outside parentheses — "${CITATION.exec(paragraph.body)?.[0]}". Put the citation ` +
              "in parentheses or reword it.",
          );
        }
        out.push(escapeMdx(paragraph.body), "");
      }
    }
  }

  return `${out.join("\n").trimEnd()}\n`;
}

/**
 * Every variable of the reference, in order.
 *
 * @param sections what {@link parseEnvExample} read.
 * @returns the variables of every section.
 */
export function variablesOf(sections: readonly ConfigSection[]): ConfigVariable[] {
  return sections.flatMap((section) => section.variables);
}
