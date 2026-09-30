/**
 * A skill as a document — markdown with YAML frontmatter — and back (BF.1,
 * [#410](https://github.com/NobuData/ouroboros/issues/410)).
 *
 * Mockup 14's caption is the storage model: *"Skills are markdown with frontmatter — edit in the
 * Workflow Studio editor."* The database stores the two halves apart (`skill_versions.body` and
 * the parsed `frontmatter` jsonb, V069); this file is where one text becomes the two and the two
 * become one text again, so the code view's `skills/<slug>.skill.md` round-trips.
 *
 * ```
 * ---
 * name: zephyr-conventions
 * description: Kconfig, devicetree & ISR-safety house rules
 * scope: repo
 * load: on_trigger
 * triggers: [Kconfig, devicetree, ISR]
 * ---
 *
 * # Zephyr conventions
 * …
 * ```
 *
 * **The shape is V069's `skill_frontmatter_typed`, checked here first.** The database refuses a
 * frontmatter document outside that shape, and a refusal from a `CHECK` would reach a person as a
 * `500`. So {@link FrontmatterSchema} states the same closed set of keys with the same types, and
 * `skills.frontmatter.spec.ts` holds a table of documents both sides must agree on. On top of the
 * database's rules, this service requires `name` and `description`: they are the registry row's
 * first cell, and a document that did not carry them would leave the row saying something the
 * document does not.
 *
 * **Printing is canonical.** {@link printSkillDocument} writes the keys in one order, and
 * {@link parseSkillDocument} of its output gives back the same frontmatter and body — the
 * property the code view's save relies on to say *this is what is stored*.
 */

import { isMap, parseDocument, stringify } from "yaml";
import { z } from "zod";

/** The fence that opens and closes the frontmatter, on a line of its own. */
export const FRONTMATTER_FENCE = "---";

/** `skills.name`'s limit (`skills_name_present`). */
export const SKILL_NAME_MAX_LENGTH = 120;

/** `skills.description`'s limit (`skills_description_present`). */
export const SKILL_DESCRIPTION_MAX_LENGTH = 300;

/** The most triggers a version may declare (`skill_frontmatter_typed`). */
export const MAX_TRIGGERS = 32;

/** The keys in the order {@link printSkillDocument} writes them. */
export const FRONTMATTER_KEYS = [
  "name",
  "description",
  "scope",
  "load",
  "triggers",
  "provenance",
] as const;

/** A string with something in it besides whitespace — V069's `btrim(x) <> ''`. */
const Present = z.string().refine((value) => value.trim() !== "", { message: "must not be blank" });

/**
 * The frontmatter, typed — `skill_frontmatter_typed(jsonb)` plus the two keys this service
 * requires. Strict: an unknown key is a typo or a field nothing reads, as V069 says.
 */
export const FrontmatterSchema = z
  .strictObject({
    name: Present.pipe(z.string().max(SKILL_NAME_MAX_LENGTH)),
    description: Present.pipe(z.string().max(SKILL_DESCRIPTION_MAX_LENGTH)),
    scope: z.enum(["org", "repo", "workflow"]).optional(),
    load: z.enum(["always", "on_trigger"]).optional(),
    triggers: z.array(Present).min(1).max(MAX_TRIGGERS).optional(),
    provenance: z
      .strictObject({
        source: Present,
        section: Present.optional(),
      })
      .optional(),
  })
  .refine((fm) => fm.load !== "on_trigger" || fm.triggers !== undefined, {
    message: "load: on_trigger needs at least one trigger",
    path: ["load"],
  });

/** A skill version's frontmatter, as this service reads and writes it. */
export type SkillFrontmatter = z.infer<typeof FrontmatterSchema>;

/** One reason a document was refused, where an editor can show it. */
export interface SkillDocumentIssue {
  /** The frontmatter key the issue is about, dotted (`provenance.source`), or `""` for the file. */
  readonly path: string;
  /** The 1-based line of the file the issue is on, when it is known. */
  readonly line: number | null;
  /** What a person should read. */
  readonly message: string;
}

/** A document that read: its frontmatter and its markdown. */
export interface ParsedSkillDocument {
  readonly frontmatter: SkillFrontmatter;
  readonly body: string;
}

/** What {@link parseSkillDocument} answers. */
export type SkillDocumentResult =
  | { readonly ok: true; readonly document: ParsedSkillDocument }
  | { readonly ok: false; readonly issues: readonly SkillDocumentIssue[] };

/**
 * Read a skill document.
 *
 * Line endings are normalised to `\n` first. The file must open with a `---` line; the next
 * `---` line closes the frontmatter, and everything after it is the body — less one blank line,
 * the one {@link printSkillDocument} writes after the fence.
 *
 * @param text - The whole file.
 * @returns The frontmatter and body, or every issue found. Never throws for a bad document.
 */
export function parseSkillDocument(text: string): SkillDocumentResult {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  if (lines[0] !== FRONTMATTER_FENCE) {
    return refuse("", 1, "A skill file opens with a --- line, then its frontmatter.");
  }

  const close = lines.indexOf(FRONTMATTER_FENCE, 1);

  if (close === -1) {
    return refuse("", lines.length, "The frontmatter is never closed with a --- line.");
  }

  const yaml = parseDocument(lines.slice(1, close).join("\n"));

  if (yaml.errors.length > 0) {
    // The YAML parser counts from the frontmatter's first line, which is the file's second.
    return {
      ok: false,
      issues: yaml.errors.map((error) => ({
        path: "",
        line: error.linePos === undefined ? null : error.linePos[0].line + 1,
        message: error.message.split("\n")[0],
      })),
    };
  }

  // An empty frontmatter parses to null, which is an empty object with nothing in it.
  if (yaml.contents !== null && !isMap(yaml.contents)) {
    return refuse("", 2, "The frontmatter must be a set of key: value lines.");
  }

  const checked = FrontmatterSchema.safeParse(yaml.toJS() ?? {});

  if (!checked.success) {
    return {
      ok: false,
      issues: checked.error.issues.map((issue) => {
        const path = issue.path.map(String).join(".");

        return {
          path,
          line: lineOfKey(lines.slice(1, close), String(issue.path[0] ?? "")),
          message: path === "" ? issue.message : `${path}: ${issue.message}`,
        };
      }),
    };
  }

  const rest = lines.slice(close + 1);
  const body = (rest[0] === "" ? rest.slice(1) : rest).join("\n");

  return { ok: true, document: { frontmatter: checked.data, body } };
}

/**
 * Print a skill document — the inverse of {@link parseSkillDocument}.
 *
 * @param frontmatter - The frontmatter. Keys are written in {@link FRONTMATTER_KEYS}' order and
 *   an absent key is not written.
 * @param body - The markdown.
 * @returns The file: the fenced frontmatter, one blank line, the body.
 */
export function printSkillDocument(frontmatter: Record<string, unknown>, body: string): string {
  const ordered: Record<string, unknown> = {};

  for (const key of FRONTMATTER_KEYS) {
    if (frontmatter[key] !== undefined) ordered[key] = frontmatter[key];
  }

  // Keys this service does not know are kept, last, rather than dropped: a stored document is
  // shown as it is, and the next save is what refuses it.
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!(key in ordered) && value !== undefined) ordered[key] = value;
  }

  const yaml = Object.keys(ordered).length === 0 ? "" : stringify(ordered, { lineWidth: 0 });

  return `${FRONTMATTER_FENCE}\n${yaml}${FRONTMATTER_FENCE}\n\n${body}`;
}

/**
 * A refusal with one issue.
 *
 * @param path - The key, or `""`.
 * @param line - The line.
 * @param message - What to read.
 * @returns The result.
 */
function refuse(path: string, line: number, message: string): SkillDocumentResult {
  return { ok: false, issues: [{ path, line, message }] };
}

/**
 * The file line a top-level frontmatter key is written on.
 *
 * @param frontmatter - The frontmatter's lines, without the fences.
 * @param key - The key.
 * @returns The 1-based line in the whole file, or `null` when the key is not written (a missing
 *   required key has no line of its own).
 */
function lineOfKey(frontmatter: readonly string[], key: string): number | null {
  if (key === "") return null;

  const index = frontmatter.findIndex((line) => line.startsWith(`${key}:`));

  // +2: one for 1-based lines, one for the opening fence.
  return index === -1 ? null : index + 2;
}
