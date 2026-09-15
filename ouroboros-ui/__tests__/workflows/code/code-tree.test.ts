import { describe, expect, it } from "vitest";

import type { WorkflowCodeTreeFile } from "@/app/api/workflows";
import { buildTree, directoryOf, treeMove, visibleRows } from "@/app/workflows/code/code-tree";

import { codeTreeFor } from "../../helpers/workflow-code";

/**
 * The explorer's tree, as decisions (V.3, #171): what the tree may claim — **no `skills/` or
 * `lib/` placeholder rows (C6)** — and the WAI-ARIA tree keyboard that makes it **fully keyboard
 * operable**. The drawing is `code-workbench.test.tsx`'s.
 */

/** The seeded workspace's explorer, as U.3 serves it. */
const SEEDED = codeTreeFor().files;

/**
 * A key press with no modifier held, unless the case says otherwise.
 *
 * @param key `KeyboardEvent.key`.
 * @param modifiers The modifiers this case holds.
 * @returns The event's fields the decision reads.
 */
function press(key: string, modifiers: Partial<Record<"altKey" | "ctrlKey" | "metaKey" | "shiftKey", boolean>> = {}) {
  return { key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers };
}

/**
 * A served file.
 *
 * @param path Its path.
 * @returns The file, as a plain workflow file.
 */
function served(path: string): WorkflowCodeTreeFile {
  return { path, kind: "workflow", readOnly: false, slug: null, status: null };
}

describe("directoryOf", () => {
  it("names the directory a file sits in, and none for a file at the top", () => {
    expect(directoryOf("workflows/standard-fix.loop.ts")).toBe("workflows");
    expect(directoryOf("a/b/c.ts")).toBe("a/b");
    expect(directoryOf("ouroboros.config.ts")).toBeNull();
    expect(directoryOf("/rooted.ts")).toBeNull();
  });
});

describe("the tree, on the seeded registry", () => {
  const tree = buildTree(SEEDED);

  it("groups the five workflows under workflows/, in the rail's order, with the configuration after", () => {
    expect(tree.map((entry) => entry.name)).toEqual(["workflows/", "ouroboros.config.ts"]);

    const [workflows] = tree;
    expect(workflows?.kind).toBe("directory");
    expect(workflows?.kind === "directory" && workflows.files.map((file) => file.name)).toEqual([
      "standard-fix.loop.ts",
      "feature-loop.loop.ts",
      "deps-refresh.loop.ts",
      "docs-loop.loop.ts",
      "hotfix-p0.loop.ts",
    ]);
  });

  it("draws no skills/ and no lib/ — nothing is served under them (C6)", () => {
    const names = tree.flatMap((entry) =>
      entry.kind === "directory" ? [entry.name, ...entry.files.map((file) => file.name)] : [entry.name],
    );

    expect(names.filter((name) => /^(skills|lib)\//.test(name))).toEqual([]);
    expect(names).toHaveLength(7);
  });

  it("carries each file as served — hotfix-p0 paused, the configuration read-only", () => {
    const [workflows, config] = tree;

    expect(workflows?.kind === "directory" && workflows.files[4]?.file.status).toBe("paused");
    expect(config?.kind === "file" && config.file).toEqual({
      path: "ouroboros.config.ts",
      kind: "config",
      readOnly: true,
      slug: null,
      status: null,
    });
  });
});

describe("the tree's honesty", () => {
  it("draws a directory the day a file under it is served — X.2's skills/, between workflows/ and the configuration", () => {
    const tree = buildTree([...SEEDED.slice(0, 5), served("skills/repo-map.skill.md"), ...SEEDED.slice(5)]);

    expect(tree.map((entry) => entry.name)).toEqual(["workflows/", "skills/", "ouroboros.config.ts"]);
  });

  it("draws nothing for a project with no files", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("draws a path served twice once", () => {
    const tree = buildTree([served("workflows/a.loop.ts"), served("workflows/a.loop.ts")]);

    expect(tree[0]?.kind === "directory" && tree[0].files).toHaveLength(1);
  });

  it("groups a deeper file under its whole directory, inventing no parent that holds nothing", () => {
    expect(buildTree([served("a/b/c.ts")]).map((entry) => entry.name)).toEqual(["a/b/"]);
  });

  it("gives a directory an id no file can have", () => {
    expect(buildTree(SEEDED)[0]?.id).toBe("workflows/");
  });
});

describe("the visible rows", () => {
  const tree = buildTree(SEEDED);

  it("opens every directory by default, as mockup 05 draws them", () => {
    expect(visibleRows(tree, new Set())).toEqual([
      { id: "workflows/", kind: "directory", parent: null, expanded: true },
      { id: "workflows/standard-fix.loop.ts", kind: "file", parent: "workflows/", expanded: null },
      { id: "workflows/feature-loop.loop.ts", kind: "file", parent: "workflows/", expanded: null },
      { id: "workflows/deps-refresh.loop.ts", kind: "file", parent: "workflows/", expanded: null },
      { id: "workflows/docs-loop.loop.ts", kind: "file", parent: "workflows/", expanded: null },
      { id: "workflows/hotfix-p0.loop.ts", kind: "file", parent: "workflows/", expanded: null },
      { id: "ouroboros.config.ts", kind: "file", parent: null, expanded: null },
    ]);
  });

  it("hides a closed directory's files", () => {
    expect(visibleRows(tree, new Set(["workflows/"])).map((row) => row.id)).toEqual([
      "workflows/",
      "ouroboros.config.ts",
    ]);
  });
});

describe("the keyboard", () => {
  const tree = buildTree(SEEDED);
  const open = visibleRows(tree, new Set());
  const closed = visibleRows(tree, new Set(["workflows/"]));
  const STANDARD_FIX = "workflows/standard-fix.loop.ts";
  const HOTFIX = "workflows/hotfix-p0.loop.ts";
  const CONFIG = "ouroboros.config.ts";

  it("walks the visible rows with Up and Down, and stops at the ends", () => {
    expect(treeMove(press("ArrowDown"), open, "workflows/")).toEqual({ kind: "focus", id: STANDARD_FIX });
    expect(treeMove(press("ArrowDown"), open, HOTFIX)).toEqual({ kind: "focus", id: CONFIG });
    expect(treeMove(press("ArrowDown"), open, CONFIG)).toBeNull();
    expect(treeMove(press("ArrowUp"), open, STANDARD_FIX)).toEqual({ kind: "focus", id: "workflows/" });
    expect(treeMove(press("ArrowUp"), open, "workflows/")).toBeNull();
    expect(treeMove(press("ArrowDown"), closed, "workflows/")).toEqual({ kind: "focus", id: CONFIG });
  });

  it("jumps to the ends with Home and End", () => {
    expect(treeMove(press("Home"), open, HOTFIX)).toEqual({ kind: "focus", id: "workflows/" });
    expect(treeMove(press("End"), open, STANDARD_FIX)).toEqual({ kind: "focus", id: CONFIG });
  });

  it("opens a directory with Right, then steps into it", () => {
    expect(treeMove(press("ArrowRight"), closed, "workflows/")).toEqual({ kind: "toggle", id: "workflows/" });
    expect(treeMove(press("ArrowRight"), open, "workflows/")).toEqual({ kind: "focus", id: STANDARD_FIX });
    expect(treeMove(press("ArrowRight"), open, STANDARD_FIX)).toBeNull();
  });

  it("closes a directory with Left, and steps out of one to it", () => {
    expect(treeMove(press("ArrowLeft"), open, "workflows/")).toEqual({ kind: "toggle", id: "workflows/" });
    expect(treeMove(press("ArrowLeft"), open, HOTFIX)).toEqual({ kind: "focus", id: "workflows/" });
    expect(treeMove(press("ArrowLeft"), closed, "workflows/")).toBeNull();
    expect(treeMove(press("ArrowLeft"), open, CONFIG)).toBeNull();
  });

  it("opens a file, and toggles a directory, with Enter or Space", () => {
    expect(treeMove(press("Enter"), open, CONFIG)).toEqual({ kind: "open", id: CONFIG });
    expect(treeMove(press(" "), open, HOTFIX)).toEqual({ kind: "open", id: HOTFIX });
    expect(treeMove(press("Enter"), open, "workflows/")).toEqual({ kind: "toggle", id: "workflows/" });
  });

  it("answers no chord and no other key, so a shortcut pressed in the tree reaches its handler", () => {
    for (const modifier of ["altKey", "ctrlKey", "metaKey"] as const) {
      expect(treeMove(press("ArrowDown", { [modifier]: true }), open, "workflows/")).toBeNull();
    }
    expect(treeMove(press("a"), open, "workflows/")).toBeNull();
    expect(treeMove(press("Tab"), open, "workflows/")).toBeNull();
  });

  it("lands a row it answers on the first visible row when the focused one is hidden", () => {
    expect(treeMove(press("ArrowDown"), closed, STANDARD_FIX)).toEqual({ kind: "focus", id: "workflows/" });
    expect(treeMove(press("a"), closed, STANDARD_FIX)).toBeNull();
  });

  it("does nothing in an empty tree", () => {
    expect(treeMove(press("ArrowDown"), [], "workflows/")).toBeNull();
  });
});
