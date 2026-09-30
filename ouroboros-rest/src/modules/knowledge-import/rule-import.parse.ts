/**
 * The deterministic parse of an agent rules file (BF.4,
 * [#413](https://github.com/NobuData/ouroboros/issues/413)) — pure, no I/O.
 *
 * ```
 * CLAUDE.md ─▶ strip leading frontmatter ─▶ headings outside fences?
 *                 ├─ yes → one skill draft per section at the section level
 *                 └─ no  → one skill draft for the whole file (no invented structure)
 *            ─▶ every short imperative bullet outside fences → one fact candidate
 * ```
 *
 * **The section level** is the shallowest heading level used more than once, or — when no level
 * repeats — the shallowest level present. So a `# Project` title over `## Build` and `## Style`
 * gives two sections, `Build` and `Style`; deeper headings stay inside their section's body.
 * Text outside every section (a preamble, or text under a heading shallower than the section
 * level) becomes no skill, but its bullets are still fact candidates, with no section.
 *
 * **A fact candidate is a short imperative bullet**: a list item of at most
 * {@link FACT_CANDIDATE_MAX_LENGTH} characters whose first word is in {@link IMPERATIVE_WORDS}
 * (`Use`, `Never`, `Don't`, …), and which does not end in `:` (a bullet introducing a sub-list is
 * not a rule). A bullet is both part of its section's skill body and a fact candidate — the skill
 * keeps the context, the fact is the reviewable one-liner.
 *
 * Nothing here decides what is new: {@link planImport} in `rule-import.plan.ts` dedupes.
 */

/** A skill draft the parse proposes — one section, or the whole file. */
export interface ParsedSkill {
  /** The rules file, as probed — `CLAUDE.md`. */
  readonly file: string;
  /**
   * The heading the section was split at, made unique within the file (`Style (2)` for a second
   * `Style`), or `null` for a file with no headings.
   */
  readonly section: string | null;
  /** The skill's name: the heading's text, or the file's name. At most 120 characters. */
  readonly name: string;
  /** The lead paragraph, or a sentence naming the source. At most 300 characters. */
  readonly description: string;
  /** The section's markdown, without its own heading line. Never blank. */
  readonly body: string;
}

/** A fact candidate the parse proposes — one short imperative bullet. */
export interface ParsedFact {
  /** The rules file. */
  readonly file: string;
  /** The section the bullet sat in (as {@link ParsedSkill.section}), or `null` outside one. */
  readonly section: string | null;
  /** The bullet's text, inline markup other than code spans removed, whitespace collapsed. */
  readonly text: string;
}

/** What one file parsed into. */
export interface ParsedRuleFile {
  readonly skills: readonly ParsedSkill[];
  readonly facts: readonly ParsedFact[];
}

/** The longest bullet a fact candidate is made from — longer is prose, not a rule. */
export const FACT_CANDIDATE_MAX_LENGTH = 200;

/** `skills_name_present`'s bound (V069). */
const NAME_MAX_LENGTH = 120;

/** `skills_description_present`'s bound (V069). */
const DESCRIPTION_MAX_LENGTH = 300;

/** V071's bound on an import reference's `section`. */
export const SECTION_MAX_LENGTH = 200;

/**
 * The words an imperative rule starts with. Deliberately a closed list: a deterministic parse is
 * one a person can predict from the file, and a list is what they can read.
 */
export const IMPERATIVE_WORDS: ReadonlySet<string> = new Set([
  "add",
  "always",
  "annotate",
  "apply",
  "ask",
  "avoid",
  "build",
  "cache",
  "call",
  "catch",
  "check",
  "close",
  "commit",
  "configure",
  "consider",
  "cover",
  "create",
  "declare",
  "define",
  "delete",
  "describe",
  "disable",
  "do",
  "document",
  "don't",
  "dont",
  "emit",
  "enable",
  "ensure",
  "explain",
  "export",
  "extract",
  "favor",
  "favour",
  "fix",
  "follow",
  "format",
  "group",
  "guard",
  "handle",
  "import",
  "include",
  "install",
  "keep",
  "leave",
  "limit",
  "lint",
  "list",
  "log",
  "make",
  "mark",
  "match",
  "mention",
  "merge",
  "migrate",
  "mock",
  "move",
  "name",
  "never",
  "note",
  "only",
  "open",
  "pass",
  "pin",
  "place",
  "prefer",
  "prefix",
  "print",
  "push",
  "put",
  "raise",
  "read",
  "record",
  "reject",
  "remove",
  "rename",
  "replace",
  "require",
  "respect",
  "restrict",
  "retry",
  "return",
  "reuse",
  "review",
  "run",
  "save",
  "separate",
  "set",
  "skip",
  "sort",
  "split",
  "start",
  "stick",
  "stop",
  "store",
  "test",
  "throw",
  "treat",
  "update",
  "use",
  "validate",
  "verify",
  "wait",
  "wrap",
  "write",
]);

/** An ATX heading: up to three spaces, 1–6 `#`, a space, the text, optional closing `#`s. */
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/** A code fence's opening or closing line. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** A list item: `-`, `*`, `+` or `1.` / `1)`, then a space, then the text. */
const BULLET = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

/** A task-list checkbox at the start of a bullet's text. */
const CHECKBOX = /^\[[ xX]\][ \t]+/;

/** One line, as the section walk sees it. */
interface Line {
  /** The text. */
  readonly text: string;
  /** Whether it sits inside (or opens or closes) a fenced code block. */
  readonly fenced: boolean;
  /** The heading's level and text, when the line is a heading outside a fence. */
  readonly heading?: { readonly level: number; readonly text: string };
}

/**
 * Parse one rules file.
 *
 * @param file - The path it was probed at — `CLAUDE.md`, `.cursorrules`, …
 * @param content - Its text.
 * @returns The skill drafts and fact candidates it holds, in file order.
 */
export function parseRuleFile(file: string, content: string): ParsedRuleFile {
  const lines = classify(stripFrontmatter(content.replace(/\r\n?/g, "\n")).split("\n"));
  const level = sectionLevel(lines);

  if (level === undefined) {
    const body = trimBlankLines(lines.map((line) => line.text)).join("\n");
    const name = clip(file, NAME_MAX_LENGTH);

    return {
      skills: body === "" ? [] : [skillOf(file, null, name, body)],
      facts: factsOf(file, null, lines),
    };
  }

  const skills: ParsedSkill[] = [];
  const facts: ParsedFact[] = [];
  const seen = new Map<string, number>();
  let current: { section: string; name: string; lines: Line[] } | null = null;
  let loose: Line[] = [];

  const close = (): void => {
    if (current === null) {
      facts.push(...factsOf(file, null, loose));
      loose = [];
      return;
    }

    const body = trimBlankLines(current.lines.map((line) => line.text)).join("\n");

    if (body !== "") skills.push(skillOf(file, current.section, current.name, body));
    facts.push(...factsOf(file, current.section, current.lines));
    current = null;
  };

  for (const line of lines) {
    if (line.heading !== undefined && line.heading.level <= level) {
      close();

      if (line.heading.level === level) {
        const name = clip(plainText(line.heading.text), NAME_MAX_LENGTH);
        current = { section: uniqueSection(name, seen), name, lines: [] };
      }

      continue;
    }

    if (current === null) loose.push(line);
    else current.lines.push(line);
  }

  close();

  return { skills, facts };
}

/**
 * The fact dedupe key — shared with BF.3's proposers (#412), so it lives with the facts.
 */
export { normalizeFactText } from "../facts/facts.text";

/**
 * Normalize a skill body for dedupe: trailing whitespace and runs of blank lines are not changes.
 *
 * @param body - A skill version's markdown.
 * @returns The comparison key.
 */
export function normalizeSkillBody(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Drop a leading YAML frontmatter block — `.github/copilot-instructions.md` sometimes carries
 * one (`applyTo:`), and it is configuration for another tool, not a rule.
 *
 * @param content - The file, LF line endings.
 * @returns The file without it.
 */
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) return content;

  const end = content.indexOf("\n---", 3);

  if (end === -1) return content;

  const after = content.indexOf("\n", end + 4);
  const closing = content.slice(end + 1, after === -1 ? undefined : after).trim();

  if (closing !== "---") return content;

  return after === -1 ? "" : content.slice(after + 1);
}

/**
 * Mark each line fenced or not, and read headings outside fences.
 *
 * @param raw - The file's lines.
 * @returns The classified lines.
 */
function classify(raw: readonly string[]): Line[] {
  const lines: Line[] = [];
  let fence: string | null = null;

  for (const text of raw) {
    const marker = FENCE.exec(text)?.[1];

    if (fence !== null) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }

      lines.push({ text, fenced: true });
      continue;
    }

    if (marker !== undefined) {
      fence = marker;
      lines.push({ text, fenced: true });
      continue;
    }

    const heading = HEADING.exec(text);
    const title = heading?.[2]?.trim() ?? "";

    lines.push(
      heading !== null && plainText(title) !== ""
        ? { text, fenced: false, heading: { level: heading[1].length, text: title } }
        : { text, fenced: false },
    );
  }

  return lines;
}

/**
 * The heading level sections are split at — see this file's header.
 *
 * @param lines - The classified lines.
 * @returns The level, or `undefined` for a file with no headings.
 */
function sectionLevel(lines: readonly Line[]): number | undefined {
  const counts = new Map<number, number>();

  for (const line of lines) {
    if (line.heading !== undefined) {
      counts.set(line.heading.level, (counts.get(line.heading.level) ?? 0) + 1);
    }
  }

  const levels = [...counts.keys()].sort((a, b) => a - b);

  return levels.find((level) => (counts.get(level) ?? 0) > 1) ?? levels[0];
}

/**
 * A section name unique within its file — the dedupe key is `(file, section)`, so two `Style`
 * headings must not share one.
 *
 * @param name - The heading's plain text.
 * @param seen - How often each name was used so far; updated.
 * @returns The name, or `name (n)` for its n-th use, within V071's section bound.
 */
function uniqueSection(name: string, seen: Map<string, number>): string {
  const count = (seen.get(name) ?? 0) + 1;

  seen.set(name, count);

  if (count === 1) return clip(name, SECTION_MAX_LENGTH);

  const suffix = ` (${String(count)})`;

  return clip(name, SECTION_MAX_LENGTH - suffix.length) + suffix;
}

/**
 * A skill draft.
 *
 * @param file - The rules file.
 * @param section - The section, or null.
 * @param name - The skill's name.
 * @param body - The markdown, not blank.
 * @returns The draft, with its description taken from the lead paragraph.
 */
function skillOf(file: string, section: string | null, name: string, body: string): ParsedSkill {
  const lead = leadParagraph(body);
  const fallback =
    section === null ? `Imported from ${file}.` : `Imported from ${file} — ${section}.`;

  return {
    file,
    section,
    name,
    description: clip(lead === "" ? fallback : lead, DESCRIPTION_MAX_LENGTH),
    body,
  };
}

/**
 * The first paragraph of prose — not a heading, list, quote, table, fence or HTML comment.
 *
 * @param body - A section's markdown.
 * @returns Its plain text, whitespace collapsed; `""` when the section has no prose.
 */
function leadParagraph(body: string): string {
  const paragraph: string[] = [];
  let fenced = false;

  for (const line of body.split("\n")) {
    if (FENCE.test(line)) {
      if (paragraph.length > 0) break;
      fenced = !fenced;
      continue;
    }

    if (fenced) continue;

    const trimmed = line.trim();
    const prose =
      trimmed !== "" &&
      !HEADING.test(line) &&
      !BULLET.test(line) &&
      !/^(?:>|\||<!--)/.test(trimmed);

    if (prose) paragraph.push(trimmed);
    else if (paragraph.length > 0) break;
  }

  return plainText(paragraph.join(" "));
}

/**
 * The fact candidates among some lines.
 *
 * @param file - The rules file.
 * @param section - The section the lines sit in, or null.
 * @param lines - The lines.
 * @returns One candidate per short imperative bullet outside a fence, in order.
 */
function factsOf(file: string, section: string | null, lines: readonly Line[]): ParsedFact[] {
  const facts: ParsedFact[] = [];
  let item: { indent: number; parts: string[] } | null = null;

  const flush = (): void => {
    if (item === null) return;

    const text = plainText(item.parts.join(" ").replace(CHECKBOX, ""));

    if (isRule(text)) facts.push({ file, section, text });
    item = null;
  };

  for (const line of lines) {
    const bullet = line.fenced || line.heading !== undefined ? null : BULLET.exec(line.text);

    if (bullet !== null) {
      flush();
      item = { indent: bullet[1].length, parts: [bullet[2]] };
      continue;
    }

    // A continuation is a non-blank line indented past its bullet's marker.
    const indent = /^[ \t]*/.exec(line.text)?.[0].length ?? 0;

    if (item !== null && !line.fenced && line.text.trim() !== "" && indent > item.indent) {
      item.parts.push(line.text.trim());
    } else {
      flush();
    }
  }

  flush();

  return facts;
}

/**
 * Whether a bullet's text is a short imperative rule.
 *
 * @param text - The bullet, as plain text.
 * @returns True for at most {@link FACT_CANDIDATE_MAX_LENGTH} characters, two words or more,
 *   a first word in {@link IMPERATIVE_WORDS}, and no trailing `:`.
 */
function isRule(text: string): boolean {
  if (text.length > FACT_CANDIDATE_MAX_LENGTH || text.endsWith(":")) return false;

  const words = text.split(" ");
  const first = words[0]
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z']/g, "");

  return words.length >= 2 && IMPERATIVE_WORDS.has(first);
}

/**
 * Inline markdown to plain text: emphasis markers and link targets dropped, code spans kept
 * (with their backticks — `` `k_msgq` `` is the rule), whitespace collapsed.
 *
 * @param markdown - One line or paragraph.
 * @returns The text.
 */
function plainText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](?=\S)([^*_]+?)(?<=\S)[*_](?=$|[^\w*])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cut text to a length, marking the cut with an ellipsis.
 *
 * @param text - The text.
 * @param max - The most characters the result may hold.
 * @returns The text, or its first `max - 1` characters (trailing space dropped) and `…`.
 */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Drop leading and trailing blank lines.
 *
 * @param lines - The lines.
 * @returns The lines between the first and last non-blank one.
 */
function trimBlankLines(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;

  return lines.slice(start, end).map((line) => line.trimEnd());
}
