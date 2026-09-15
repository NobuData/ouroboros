import type {
  WorkflowCode,
  WorkflowCodeConfig,
  WorkflowCodeTree,
  WorkflowRailEntry,
} from "@/app/api/workflows";
import type { CodeReadings, ExplorerReadings, FileReading } from "@/app/workflows/code/code-view";

import { railEntry, seededRail, unpublishedEntry, workflowDetail } from "./workflows";

/**
 * Fixtures for the code view (V.1, #169): the seeded `standard-fix` as U.3's
 * `GET /api/v1/workflows/{slug}/code` serves it, and the readings the code route hands its
 * screen.
 */

/**
 * A short, faithful-in-shape `standard-fix.loop.ts`: an import, a blank line, the loop, and the
 * trailing line feed U.3 ends every file with.
 *
 * Short on purpose — the byte-exact golden file is U.1's and `ouroboros-rest`'s parity suite
 * holds it; what a UI suite needs is lines with indentation, a blank one, and an ending.
 */
export const STANDARD_FIX_TEXT = [
  'import { defineLoop, trigger, llm } from "@ouroboros/sdk";',
  "",
  'export default defineLoop("standard-fix", {',
  '  dsl: "1.0",',
  "  stages: [",
  '    trigger("issue-queued", { title: "Issue queued", next: "analyze" }),',
  "  ],",
  "});",
  "",
].join("\n");

/**
 * The seeded `standard-fix` as a file: printed from the draft, carrying the draft's etag — the
 * same token {@link workflowDetail}'s draft carries for the canvas, which is decision C3 as data.
 *
 * @param overrides What this case is about.
 * @returns The file.
 */
export function workflowCode(overrides: Partial<WorkflowCode> = {}): WorkflowCode {
  return {
    path: "workflows/standard-fix.loop.ts",
    slug: "standard-fix",
    text: STANDARD_FIX_TEXT,
    etag: workflowDetail().draft.etag,
    readOnly: false,
    version: null,
    currentVersion: 14,
    spans: [],
    diagnostics: [],
    outlineRef: null,
    checksRef: "/api/v1/workflows/standard-fix/code/checks",
    ...overrides,
  };
}

/** The unprojectable refusal's findings, as `details.findings` carries them. */
export const UNPROJECTABLE_FINDINGS = [
  { code: "schema.required", path: "/dsl_version", message: "This property is required." },
  {
    code: "stage.route_missing",
    path: "/nodes/1/config",
    node: "implement",
    message: "A model stage needs a route.",
  },
] as const;

/**
 * What U.3 answers for a draft with no faithful spelling as code — the blank canvas **+ New
 * workflow** leaves, here `hotfix-p1`'s.
 */
export const UNPROJECTABLE_REFUSAL = {
  code: "workflow_code_unprojectable",
  message: "This draft cannot be shown as code yet. Finish it in the visual editor first.",
  details: { slug: "hotfix-p1", version: null, findings: UNPROJECTABLE_FINDINGS },
};

/**
 * The explorer U.3's `GET /api/v1/workflows/code-tree` serves for a rail: one file per workflow,
 * in the rail's order, then `ouroboros.config.ts` — and nothing under `skills/` or `lib/`.
 *
 * @param rail The rail. Defaults to the seeded workspace's five.
 * @returns The tree.
 */
export function codeTreeFor(rail: readonly WorkflowRailEntry[] = seededRail()): WorkflowCodeTree {
  return {
    files: [
      ...rail.map((entry) => ({
        path: `workflows/${entry.slug}.loop.ts`,
        kind: "workflow" as const,
        readOnly: false,
        slug: entry.slug,
        status: entry.status,
      })),
      { path: "ouroboros.config.ts", kind: "config", readOnly: true, slug: null, status: null },
    ],
  };
}

/**
 * A short, faithful-in-shape `ouroboros.config.ts`: a comment, an import, and the registry — for
 * the reason {@link STANDARD_FIX_TEXT} is short.
 */
export const CONFIG_TEXT = [
  "// Printed from the workflow registry. Read-only.",
  'import { defineConfig } from "@ouroboros/sdk";',
  "",
  "export default defineConfig({",
  '  workflows: { "standard-fix": { status: "active", version: 14 } },',
  "});",
  "",
].join("\n");

/**
 * `ouroboros.config.ts` as `GET /api/v1/workflows/code-config` serves it.
 *
 * @returns The file.
 */
export function codeConfig(): WorkflowCodeConfig {
  return { path: "ouroboros.config.ts", text: CONFIG_TEXT, readOnly: true };
}

/**
 * The explorer's two reads, both clean.
 *
 * @param overrides What this case is about.
 * @param rail The rail the tree is served for. Defaults to the seeded workspace's.
 * @returns The readings.
 */
export function explorerReadings(
  overrides: Partial<ExplorerReadings> = {},
  rail: readonly WorkflowRailEntry[] = seededRail(),
): ExplorerReadings {
  return {
    tree: { ok: true, value: codeTreeFor(rail) },
    config: { ok: true, value: codeConfig() },
    ...overrides,
  };
}

/**
 * A file read cleanly.
 *
 * @param file The file. Defaults to the seeded `standard-fix`'s.
 * @returns The reading.
 */
export function fileRead(file: WorkflowCode = workflowCode()): FileReading {
  return { kind: "file", file };
}

/**
 * The readings for a workflow on the seeded rail whose file ended some way.
 *
 * @param entry The workflow's rail entry.
 * @param file How its file read ended.
 * @returns The readings, with the rail as seeded plus the entry when it is not already on it.
 */
export function codeReadingsFor(entry: WorkflowRailEntry, file: FileReading): CodeReadings {
  const rail = seededRail();
  const value = rail.some((candidate) => candidate.slug === entry.slug) ? rail : [...rail, entry];

  return {
    rail: { ok: true, value },
    requested: entry.slug,
    selected: { entry, file },
    explorer: explorerReadings({}, value),
  };
}

/**
 * What the code route hands its screen, for the seeded workspace opened on `standard-fix`.
 *
 * @param overrides What this case is about.
 * @returns The readings.
 */
export function codeReadings(overrides: Partial<CodeReadings> = {}): CodeReadings {
  return {
    rail: { ok: true, value: seededRail() },
    requested: "standard-fix",
    selected: { entry: railEntry(), file: fileRead() },
    explorer: explorerReadings(),
    ...overrides,
  };
}

/**
 * The readings for `hotfix-p1` — published nothing, and a blank draft U.3 cannot print.
 *
 * @returns The readings.
 */
export function unprojectableReadings(): CodeReadings {
  return codeReadingsFor(unpublishedEntry(), {
    kind: "unprojectable",
    reason: UNPROJECTABLE_REFUSAL.message,
    findings: [
      { message: "This property is required.", node: null, path: "/dsl_version" },
      { message: "A model stage needs a route.", node: "implement", path: "/nodes/1/config" },
    ],
  });
}
