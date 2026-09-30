/**
 * What the environment-recipe routes answer (BG.4,
 * [#420](https://github.com/NobuData/ouroboros/issues/420)), and the pure mappers from rows to it.
 *
 * The recipe is mockup 14's Environment block: the ordered setup commands with their comments,
 * the version in force (`v3 · edited by Ken, 9d ago`) and where it came from. V073 stores the
 * commands as a typed jsonb array; {@link readCommands} reads it back defensively rather than
 * trusting the column, so a row that somehow held something else is a visible empty list rather
 * than a crash.
 */

import type { EnvRecipeSource } from "../db/schema";

/** One setup command, in run order, with the comment people read beside it. */
export interface EnvRecipeCommand {
  /** The line a consumer runs in a shell at the repository root. */
  readonly command: string;
  /** For people; never executed. `null` when the entry has none. */
  readonly comment: string | null;
}

/** Who saved a version, as the card names them. */
export interface EnvRecipeEditor {
  readonly id: string;
  readonly name: string;
}

/** The recipe in force for a repository. */
export interface EnvRecipeResource {
  /** `owner/name`, lower-case. */
  readonly repo: string;
  /** The version in force — the `v3` of `v3 · edited`. */
  readonly version: number;
  /** The commands, in the order consumers run them. */
  readonly commands: readonly EnvRecipeCommand[];
  /** `detected` (a rule pack seeded it) or `edited` (a person saved it). */
  readonly source: EnvRecipeSource;
  /** When this version was saved. */
  readonly updatedAt: string;
  /** Who saved it — null for a detected draft, or a person since removed. */
  readonly updatedBy: EnvRecipeEditor | null;
}

/** The current-version row as the repository reads it, with the editor's name joined. */
export interface EnvRecipeRow {
  readonly repo_ref: string;
  readonly version: number;
  readonly commands: unknown;
  readonly source: EnvRecipeSource;
  readonly updated_by: string | null;
  readonly updated_at: Date;
  /** `"user".name` of `updated_by`, or null. */
  readonly editor_name: string | null;
}

/**
 * The commands of a stored jsonb document.
 *
 * @param value - The column, as `pg` parsed it.
 * @returns The typed entries, in array order; an entry that is not an object with a string
 *   `command` is skipped.
 */
export function readCommands(value: unknown): EnvRecipeCommand[] {
  if (!Array.isArray(value)) return [];

  const commands: EnvRecipeCommand[] = [];

  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;

    const { command, comment } = entry as { command?: unknown; comment?: unknown };
    if (typeof command !== "string") continue;

    commands.push({ command, comment: typeof comment === "string" ? comment : null });
  }

  return commands;
}

/**
 * The resource for a current-version row.
 *
 * @param row - The row.
 * @returns The recipe.
 */
export function envRecipeResource(row: EnvRecipeRow): EnvRecipeResource {
  return {
    repo: row.repo_ref,
    version: row.version,
    commands: readCommands(row.commands),
    source: row.source,
    updatedAt: row.updated_at.toISOString(),
    updatedBy:
      row.updated_by === null
        ? null
        : { id: row.updated_by, name: row.editor_name ?? row.updated_by },
  };
}
