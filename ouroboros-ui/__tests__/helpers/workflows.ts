import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  WorkflowDefinition,
  WorkflowDetail,
  WorkflowRailEntry,
} from "@/app/api/workflows";
import type { SelectedWorkflow, StudioReadings } from "@/app/workflows/view";

/**
 * The studio's fixtures — the seeded workspace's rail and its `standard-fix`, as
 * `GET /api/v1/workflows` and `GET /api/v1/workflows/{id}` actually serve them.
 *
 * **These are `R__dev_seed_workflows.sql`'s five rows read through P.4's composition rules**
 * (`ouroboros-rest/src/modules/workflows/stats.captions.ts`), not five plausible-looking
 * objects: the slugs, the names (the seed sets `name` to the slug, because that is what mockup
 * 04 prints in both places it names a workflow), the statuses, the versions, the stage counts
 * and the terminal actions are the seed's, and each caption is what the service composes from
 * them. That is what makes *the seeded rail matches the mockup's five entries and their
 * states* a claim a test in this module can make at all.
 *
 * **Two of the strings are not mockup 04's, and both differences are upstream of this module
 * and recorded in `docs/ROADMAP_MOCKUP_04_WORKFLOW_BUILDER.md` (P.5, #136):**
 *
 * | The mockup draws | The product shows | Why |
 * |---|---|---|
 * | `6 stages · auto-merge` | `12 stages · auto-merge` | A stage is a node, and the seeded v14 is the mockup's own twelve-node canvas. The six-stage document the mockup's string was written for is v13. |
 * | `used by 61% of runs` | `used by 42% of runs` | Twenty-two of the dashboard seed's fifty-three runs in the window carry this slug, and no integer count of those runs rounds to 61%. |
 *
 * The other three active workflows' run counts are not asserted by any seed; the ones here
 * partition the same fifty-three so the shares are one denominator's, the way the service
 * measures them. `hotfix-p0` is the seed's one zero — `used by 0% of runs`, which is a share
 * of a real denominator and therefore printed, unlike the `null` a workspace with no runs
 * carries.
 *
 * `READ_AT` is a fixed instant rather than the clock: these fixtures back assertions about
 * *Last edited 2h ago*, and a stamp that moved with the test run would make those
 * unwritable.
 */

/** When every page in these fixtures was read. Fixed, so a rendered *ago* is too. */
export const READ_AT = "2026-09-13T12:00:00.000Z";

/** When `standard-fix`'s draft was last saved — two hours before {@link READ_AT}, as the mockup's head reads. */
export const DRAFT_EDITED_AT = "2026-09-13T10:00:00.000Z";

/** The seed's id for a rail ordinal. */
function seededId(ordinal: number): string {
  return `5eed001b-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
}

/**
 * One rail entry, defaulting to the seeded `standard-fix` as P.4 serves it.
 *
 * @param overrides What this case is about.
 * @returns The entry as the contract serves it.
 */
export function railEntry(overrides: Partial<WorkflowRailEntry> = {}): WorkflowRailEntry {
  return {
    id: seededId(1),
    slug: "standard-fix",
    name: "standard-fix",
    status: "active",
    currentVersion: 14,
    stageCount: 12,
    terminal: "open_pr_automerge",
    caption: "12 stages · auto-merge",
    runs: 22,
    usagePercent: 42,
    usageCaption: "used by 42% of runs",
    ...overrides,
  };
}

/**
 * The seeded workspace's five entries, in the order the service lists them (`created_at`).
 *
 * @returns The rail mockup 04 draws.
 */
export function seededRail(): WorkflowRailEntry[] {
  return [
    railEntry(),
    railEntry({
      id: seededId(2),
      slug: "feature-loop",
      name: "feature-loop",
      currentVersion: 1,
      stageCount: 7,
      caption: "7 stages · auto-merge",
      runs: 15,
      usagePercent: 28,
      usageCaption: "used by 28% of runs",
    }),
    railEntry({
      id: seededId(3),
      slug: "deps-refresh",
      name: "deps-refresh",
      currentVersion: 1,
      stageCount: 5,
      terminal: "needs_review",
      caption: "5 stages · needs review",
      runs: 9,
      usagePercent: 17,
      usageCaption: "used by 17% of runs",
    }),
    railEntry({
      id: seededId(4),
      slug: "docs-loop",
      name: "docs-loop",
      currentVersion: 1,
      stageCount: 4,
      caption: "4 stages · auto-merge",
      runs: 7,
      usagePercent: 13,
      usageCaption: "used by 13% of runs",
    }),
    railEntry({
      id: seededId(5),
      slug: "hotfix-p0",
      name: "hotfix-p0",
      status: "paused",
      currentVersion: 1,
      stageCount: 5,
      terminal: "needs_review",
      caption: "5 stages · paused",
      runs: 0,
      usagePercent: 0,
      usageCaption: "used by 0% of runs",
    }),
  ];
}

/**
 * An entry for a workflow that has only ever had a draft — what **+ New workflow** leaves
 * behind, with the two nulls the contract carries for it and the captions P.4 composes from
 * them.
 *
 * @returns The entry.
 */
export function unpublishedEntry(): WorkflowRailEntry {
  return railEntry({
    id: seededId(6),
    slug: "hotfix-p1",
    name: "hotfix-p1",
    currentVersion: null,
    stageCount: null,
    terminal: null,
    caption: "not published",
    runs: 0,
    usagePercent: 0,
    usageCaption: "used by 0% of runs",
  });
}

/**
 * A definition carrying one trigger and nothing else — what the frame's head reads, over a
 * canvas with nothing on it.
 *
 * @param trigger The root `trigger`, as the DSL spells it.
 * @returns The document.
 */
export function definitionWithTrigger(trigger: unknown): WorkflowDefinition {
  return { dsl_version: "1.0", trigger, nodes: [], edges: [] };
}

/**
 * The committed `standard-fix` v14 — `schemas/workflow-dsl/fixtures/valid/standard-fix.json`,
 * the document `R__dev_seed_workflows.sql` stores and `dsl.seed.spec.ts` holds it to.
 *
 * Read from the file rather than copied, so a canvas assertion about *the mockup's node
 * positions* is an assertion about the seed and not about a second transcription of it. The
 * UI's CI is routed to run on a change to this file for that reason (`.github/workflows/ui.yml`).
 */
const STANDARD_FIX = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "schemas",
  "workflow-dsl",
  "fixtures",
  "valid",
  "standard-fix.json",
);

/**
 * The seeded `standard-fix` in full: mockup 04's twelve-node canvas at v14, trigger, positions,
 * configs and the loop edge included.
 *
 * A fresh object on every call, because the canvas writes positions back into a copy of what
 * it was given and a suite must be able to compare against what it started with.
 *
 * @returns The document.
 */
export function standardFixDefinition(): WorkflowDefinition {
  return JSON.parse(readFileSync(STANDARD_FIX, "utf8")) as WorkflowDefinition;
}

/**
 * The seeded `standard-fix` in full, as `GET /api/v1/workflows/{id}` serves it: v14 in force,
 * and a draft open on the same document two hours ago.
 *
 * @param overrides What this case is about.
 * @returns The workflow.
 */
export function workflowDetail(overrides: Partial<WorkflowDetail> = {}): WorkflowDetail {
  const definition = standardFixDefinition();

  return {
    id: seededId(1),
    slug: "standard-fix",
    name: "standard-fix",
    status: "active",
    currentVersion: 14,
    createdAt: "2026-05-16T09:00:00.000Z",
    updatedAt: "2026-09-12T08:30:00.000Z",
    draft: {
      etag: "2f0a7c1d9e4b6a38c5d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0",
      definition,
      updatedAt: DRAFT_EDITED_AT,
    },
    version: {
      version: 14,
      definition,
      changeNote:
        "The effort re-check branch, the split path back to the queue, the test and " +
        "self-review stages, and the checks gate that loops back to implement.",
      publishedAt: "2026-09-11T14:00:00.000Z",
      publishedBy: "9f1c0a5e0f6d4a1b9d5e2b8f3c7a4e10",
    },
    ...overrides,
  };
}

/**
 * The selected workflow, read cleanly.
 *
 * @param entry Its rail entry. Defaults to the seeded `standard-fix`'s.
 * @param detail The workflow. Defaults to the seeded `standard-fix`.
 * @returns What the reader hands the screen for it.
 */
export function selected(
  entry: WorkflowRailEntry = railEntry(),
  detail: WorkflowDetail = workflowDetail(),
): SelectedWorkflow {
  return { entry, detail: { ok: true, value: detail } };
}

/**
 * What the reader hands the screen, for the seeded workspace opened on `standard-fix`.
 *
 * @param overrides What this case is about.
 * @returns The readings.
 */
export function readings(overrides: Partial<StudioReadings> = {}): StudioReadings {
  return {
    rail: { ok: true, value: seededRail() },
    requested: null,
    selected: selected(),
    now: READ_AT,
    ...overrides,
  };
}
