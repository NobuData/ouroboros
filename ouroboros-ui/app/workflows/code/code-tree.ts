/**
 * The explorer's tree, as decisions (V.3, [#171](https://github.com/NobuData/ouroboros/issues/171))
 * — `docs/mockups/05-workflow-code.html`'s `.ft`.
 *
 * ### The tree claims only what exists
 *
 * Decision **C6**: U.3 serves files, never directories, and this module groups them by the
 * directory in their `path`. So a directory is drawn exactly when a file under it is served — the
 * mockup's `skills/` and `lib/` appear on the day X.2 ([#181](https://github.com/NobuData/ouroboros/issues/181))
 * serves a file under them, and there is no way to draw one as an empty placeholder before then.
 *
 * ### The order is the service's
 *
 * Directories first, in the order their first file was served, each with its files in the
 * service's order (the rail's, for `workflows/`); then the files at the top of the project, as
 * mockup 05 draws `ouroboros.config.ts` under the directories. A file nested deeper than one
 * directory is grouped under its whole directory path — U.3 serves none, and a group named
 * `a/b/` says what is true without inventing an `a/` that holds nothing directly.
 *
 * ### The keyboard is the WAI-ARIA tree pattern
 *
 * Up and Down walk the visible rows, Home and End jump to the ends, Right opens a directory and
 * then steps into it, Left closes it or steps out to it, and Enter or Space opens a file or
 * toggles a directory. A press with Alt, Ctrl or ⌘ held is none of these, so a shortcut chord
 * pressed in the tree reaches whatever handles it.
 *
 * **Framework-free and pure**: an event is read as the fields the decision needs, which a DOM
 * `KeyboardEvent` and a React synthetic one both satisfy (`app/workflows/canvas/keys.ts`).
 */

import type { WorkflowCodeTreeFile } from "@/app/api/workflows";

import type { ShortcutEvent } from "../canvas/keys";
import { baseName } from "./code-view";

/** One file in the tree. */
export interface TreeFile {
  readonly kind: "file";
  /** The row's identity — the file's path. */
  readonly id: string;
  /** What the row prints — the path's last segment. */
  readonly name: string;
  /** The file as the service served it. */
  readonly file: WorkflowCodeTreeFile;
}

/** One directory in the tree, which exists because at least one file is under it. */
export interface TreeDirectory {
  readonly kind: "directory";
  /** The row's identity — the directory's path and a slash, which no file's path can be. */
  readonly id: string;
  /** What the row prints — `workflows/`. */
  readonly name: string;
  /** Its files, in the service's order. Never empty. */
  readonly files: readonly TreeFile[];
}

/** A top-level entry: a directory, or a file at the top of the project. */
export type TreeEntry = TreeDirectory | TreeFile;

/**
 * The directory a path sits in.
 *
 * @param path The file's path.
 * @returns `workflows` for `workflows/standard-fix.loop.ts`, or `null` for a file at the top.
 */
export function directoryOf(path: string): string | null {
  const at = path.lastIndexOf("/");
  return at <= 0 ? null : path.slice(0, at);
}

/**
 * Group the served files into the tree.
 *
 * @param files The explorer's files, in the service's order. A path served twice is drawn once.
 * @returns The directories in the order their first file came, then the top-level files.
 */
export function buildTree(files: readonly WorkflowCodeTreeFile[]): readonly TreeEntry[] {
  const directories = new Map<string, TreeFile[]>();
  const roots: TreeFile[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);

    const entry: TreeFile = { kind: "file", id: file.path, name: baseName(file.path), file };
    const directory = directoryOf(file.path);

    if (directory === null) {
      roots.push(entry);
    } else {
      directories.set(directory, [...(directories.get(directory) ?? []), entry]);
    }
  }

  return [
    ...[...directories].map(
      ([path, grouped]): TreeDirectory => ({
        kind: "directory",
        id: `${path}/`,
        name: `${path}/`,
        files: grouped,
      }),
    ),
    ...roots,
  ];
}

/** One row the keyboard can reach — a top-level entry, or a file inside an open directory. */
export interface TreeRow {
  /** The entry's identity. */
  readonly id: string;
  readonly kind: "directory" | "file";
  /** The directory the row is inside, or `null` at the top. */
  readonly parent: string | null;
  /** Whether a directory is open; `null` for a file. */
  readonly expanded: boolean | null;
}

/**
 * The rows the keyboard walks, top to bottom.
 *
 * @param entries The tree.
 * @param collapsed The ids of the directories the reader closed. Every other directory is open,
 *   as mockup 05 draws them.
 * @returns The visible rows, in the order they are drawn.
 */
export function visibleRows(
  entries: readonly TreeEntry[],
  collapsed: ReadonlySet<string>,
): readonly TreeRow[] {
  return entries.flatMap((entry): TreeRow[] => {
    if (entry.kind === "file") {
      return [{ id: entry.id, kind: "file", parent: null, expanded: null }];
    }

    const expanded = !collapsed.has(entry.id);
    const directory: TreeRow = { id: entry.id, kind: "directory", parent: null, expanded };

    return expanded
      ? [
          directory,
          ...entry.files.map(
            (file): TreeRow => ({ id: file.id, kind: "file", parent: entry.id, expanded: null }),
          ),
        ]
      : [directory];
  });
}

/** What a key press in the tree asks for. */
export type TreeMove =
  /** Move the keyboard to this row. */
  | { readonly kind: "focus"; readonly id: string }
  /** Open or close this directory. */
  | { readonly kind: "toggle"; readonly id: string }
  /** Open this file. */
  | { readonly kind: "open"; readonly id: string };

/** The keys the tree answers. */
const TREE_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End", "ArrowRight", "ArrowLeft", "Enter", " "]);

/**
 * What a key press in the tree does.
 *
 * @param event The key press.
 * @param rows The visible rows, from {@link visibleRows}.
 * @param focused The id of the row the keyboard is on. A row that is no longer visible — its
 *   directory was closed — is treated as being before the first, so any key lands on a real row.
 * @returns The move, or `null` for a press the tree does not answer.
 */
export function treeMove(
  event: ShortcutEvent,
  rows: readonly TreeRow[],
  focused: string,
): TreeMove | null {
  if (event.altKey || event.ctrlKey || event.metaKey || !TREE_KEYS.has(event.key)) return null;

  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first === undefined || last === undefined) return null;

  const index = rows.findIndex((row) => row.id === focused);
  const row = rows[index];
  if (row === undefined) return { kind: "focus", id: first.id };

  const focus = (target: TreeRow | undefined): TreeMove | null =>
    target === undefined ? null : { kind: "focus", id: target.id };

  switch (event.key) {
    case "ArrowDown":
      return focus(rows[index + 1]);
    case "ArrowUp":
      return focus(rows[index - 1]);
    case "Home":
      return focus(first);
    case "End":
      return focus(last);
    case "ArrowRight":
      if (row.kind !== "directory") return null;
      if (row.expanded !== true) return { kind: "toggle", id: row.id };
      return rows[index + 1]?.parent === row.id ? focus(rows[index + 1]) : null;
    case "ArrowLeft":
      if (row.kind === "directory" && row.expanded === true) return { kind: "toggle", id: row.id };
      return row.parent === null ? null : { kind: "focus", id: row.parent };
    default:
      // Enter and Space.
      return row.kind === "directory" ? { kind: "toggle", id: row.id } : { kind: "open", id: row.id };
  }
}
