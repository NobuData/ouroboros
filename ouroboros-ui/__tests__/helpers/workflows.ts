import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  WorkflowDefinition,
  WorkflowDetail,
  WorkflowRailEntry,
  WorkflowStageCatalog,
  WorkflowStageType,
} from "@/app/api/workflows";
import type { EdgeRef } from "@/app/workflows/canvas/graph";
import type { InspectorReadings, SelectedWorkflow, StudioReadings } from "@/app/workflows/view";

import { seededAliases, seededTaskKinds } from "./models";

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
 * The workflows seed — `ouroboros-db/migrations/R__dev_seed_workflows.sql`, which stores `docs-loop`'s
 * version 1 between `$docs_loop_v1$` dollar quotes.
 */
const WORKFLOWS_SEED = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "ouroboros-db",
  "migrations",
  "R__dev_seed_workflows.sql",
);

/**
 * The seeded `docs-loop` v1 — the rail's shortest workflow, and the one S.5's scripted test builds from a
 * blank canvas (#151). Read out of the seed rather than copied, for `standardFixDefinition`'s reason; the
 * UI's CI is routed to run on a change to that migration (`.github/workflows/ui.yml`).
 *
 * @returns The document.
 */
export function docsLoopDefinition(): WorkflowDefinition {
  const match = /\$docs_loop_v1\$([\s\S]*?)\$docs_loop_v1\$/.exec(readFileSync(WORKFLOWS_SEED, "utf8"));
  if (match === null) throw new Error("the workflows seed no longer holds docs_loop_v1");

  return JSON.parse(match[1]) as WorkflowDefinition;
}

/**
 * Mockup 04's active path — the four `.edge.active` segments it draws in the accent, from the
 * trigger through the effort re-check to implement — named the way the dry run's
 * `highlight_path` names edges.
 *
 * The fixture the canvas's highlight mode (#149) is exercised with ahead of the dry run that will
 * feed it: S.6's acceptance criterion is that a dry run of the seeded `standard-fix` for `#485`
 * paints *the mockup's exact active path* (#152), and this is that path.
 */
export const MOCKUP_ACTIVE_PATH: readonly EdgeRef[] = [
  { from: "issue-queued", to: "analyze" },
  { from: "analyze", to: "effort-recheck" },
  { from: "effort-recheck", to: "plan" },
  { from: "plan", to: "implement" },
];

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
    inspector: inspectorReadings(),
    now: READ_AT,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ the inspector (#150) */

/**
 * The published DSL schema — `schemas/workflow-dsl/v1.json`, the file R.3's catalog reads its
 * config schemas from. Read rather than transcribed, so an inspector form generated in a test is
 * generated from the grammar the service serves.
 */
const DSL_SCHEMA = join(import.meta.dirname, "..", "..", "..", "schemas", "workflow-dsl", "v1.json");

/** The schema's `$id`, as the catalog echoes it. */
export const DSL_SCHEMA_ID = "https://ouroboros.build/schemas/workflow-dsl/v1.json";

/**
 * The published DSL schema, whole — what a document is validated against at publish.
 *
 * @returns The schema, freshly parsed.
 */
export function dslSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(DSL_SCHEMA, "utf8")) as Record<string, unknown>;
}

/**
 * One node type's config schema, self-contained as the catalog serves it: the definition, with a
 * `$defs` its references resolve against. (The service trims `$defs` to exactly what the
 * definition reaches; carrying all of them resolves every reference identically.)
 *
 * @param definition The `$defs` entry — `llm_config`, `flow_config`, …
 * @returns The schema.
 */
export function configSchema(definition: string): WorkflowStageType["configSchema"] {
  const schema = JSON.parse(readFileSync(DSL_SCHEMA, "utf8")) as { $defs: Record<string, object> };

  // The contract types a config schema as an unconstrained object, so a real one is cast through
  // `unknown` — the value is the published schema itself.
  return { ...schema.$defs[definition], $defs: schema.$defs } as unknown as WorkflowStageType["configSchema"];
}

/**
 * One catalog entry.
 *
 * @param type The node type.
 * @param label What the Add-stage menu calls it.
 * @param glyph Mockup 04's glyph.
 * @param defaults A dropped node's title and config.
 * @returns The entry as `GET /api/v1/workflows/catalog` serves it.
 */
function stageType(
  type: string,
  label: string,
  glyph: string,
  defaults: { title: string; config: Record<string, unknown> },
): WorkflowStageType {
  return {
    type,
    label,
    glyph,
    class: type,
    configSchemaRef: `${DSL_SCHEMA_ID}#/$defs/${type}_config`,
    configSchema: configSchema(`${type}_config`),
    defaults: defaults as WorkflowStageType["defaults"],
  };
}

/**
 * The seeded workspace's stage catalog — `ouroboros-rest`'s presentation table
 * (`catalog.presentation.ts`) over the published schema, with the openapi example's suggestions:
 * the deployment's two configured skills and the seeded routing matrix's eight task kinds.
 *
 * @param overrides What this case is about.
 * @returns The catalog.
 */
export function stageCatalog(overrides: Partial<WorkflowStageCatalog> = {}): WorkflowStageCatalog {
  return {
    schemaId: DSL_SCHEMA_ID,
    nodeTypes: [
      stageType("trigger", "Trigger", "▸", { title: "Issue queued", config: {} }),
      stageType("llm", "Model stage", "◆", {
        title: "Model stage",
        config: { mode: "prompt", limits: { max_retries: 2, token_budget: 400_000 } },
      }),
      stageType("infra", "Build or test", "▣", { title: "Build", config: {} }),
      stageType("flow", "Decision or gate", "◇", {
        title: "Decision",
        config: { kind: "decision", predicate: { kind: "always" } },
      }),
      stageType("term", "Terminal", "●", { title: "Needs review", config: { action: "needs_review", options: {} } }),
    ],
    suggestions: {
      skills: ["repo-map", "zephyr-conventions"],
      taskRoutes: ["analyze", "estimate", "plan", "implement", "test-gen", "review", "docs", "commit-msg"],
    },
    ...overrides,
  };
}

/**
 * The inspector's three reads, all clean, for the seeded workspace.
 *
 * @param overrides What this case is about.
 * @returns The readings.
 */
export function inspectorReadings(overrides: Partial<InspectorReadings> = {}): InspectorReadings {
  return {
    catalog: { ok: true, value: stageCatalog() },
    routes: { ok: true, value: seededTaskKinds() },
    aliases: { ok: true, value: seededAliases() },
    ...overrides,
  };
}
