/**
 * What the studio leg ([#149](https://github.com/NobuData/ouroboros/issues/149)) expects the
 * seeded `standard-fix` canvas to draw — copied on purpose, for the reason `seed.ts` gives: an
 * expectation read out of the code under test is one that agrees with any bug in it.
 *
 * The document is `schemas/workflow-dsl/fixtures/valid/standard-fix.json`, which
 * `R__dev_seed_workflows.sql` stores as the workflow's draft and its v14. Each row below is what
 * `ouroboros-ui`'s `app/workflows/canvas/treatment.ts` derives from that document's node: the
 * treatment its type takes, the glyph and word its type line prints, and the chips its config
 * becomes. Where a chip differs from mockup 04's picture — the aliases for model ids, three
 * checks for fourteen — the document is what is printed, and that file says why.
 *
 * S.8 ([#154](https://github.com/NobuData/ouroboros/issues/154)) adds the frame around the canvas —
 * the rail, the inspector opened on *Implement*, the member's reasons — and the authoring loop's
 * arrangements: `standard-fix`'s draft written, sabotaged and put back over the API, which moved
 * here from `support/registry.ts` because the studio is the surface the draft belongs to.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { BrowserContext } from "@playwright/test";

import { quietly, requestAs } from "./rest";
import { SESSION_COOKIE, sessionTokenOf } from "./session";
import { REST_URL } from "./stack";

/** The studio, opened on the seeded workflow. */
export const STUDIO_PATH = "/workflows/standard-fix";

/** The page's `<h1>`: the workflow's name, which the seed sets to its slug. */
export const STUDIO_TITLE = "standard-fix";

/** The canvas region's accessible name (`app/workflows/canvas/view.ts`'s `CANVAS_LABEL`). */
export const CANVAS_LABEL = "Canvas";

/** One seeded stage, as the canvas draws it. */
export interface SeededStage {
  /** The node's id — React Flow's `data-id`. */
  readonly id: string;
  /** The stage box's whole class list: the treatment. */
  readonly treatment: string;
  /** The type line — glyph, then word — or `null` for the mini pill, which has none. */
  readonly typeLine: string | null;
  /** The chips, in order. */
  readonly chips: readonly string[];
}

/** The twelve stages, in document order. */
export const SEEDED_STAGES: readonly SeededStage[] = [
  {
    id: "issue-queued",
    treatment: "studio-node studio-node--trigger",
    typeLine: "▸Trigger",
    chips: ["effort ≤ M"],
  },
  {
    id: "analyze",
    treatment: "studio-node studio-node--llm",
    typeLine: "◆Analyze",
    chips: ["skill:repo-map", "coder-std"],
  },
  {
    id: "effort-recheck",
    treatment: "studio-node studio-node--flow",
    typeLine: "◇Decision",
    chips: ["effort ≤ M"],
  },
  {
    id: "plan",
    treatment: "studio-node studio-node--llm",
    typeLine: "◆Plan",
    chips: ["prompt template", "coder-max"],
  },
  {
    id: "split",
    treatment: "studio-node studio-node--llm",
    typeLine: "◆Split",
    chips: ["prompt template", "routed by task"],
  },
  {
    id: "back-to-queue",
    treatment: "studio-node studio-node--term studio-node--pill",
    typeLine: null,
    chips: [],
  },
  {
    id: "implement",
    treatment: "studio-node studio-node--llm",
    typeLine: "◆Implement",
    chips: ["skill:zephyr-conventions", "routed by task"],
  },
  {
    id: "build",
    treatment: "studio-node studio-node--infra",
    typeLine: "▣Build",
    chips: ["runner pool-a"],
  },
  {
    id: "test",
    treatment: "studio-node studio-node--infra",
    typeLine: "▣Test",
    chips: ["twister -p native_sim", "runner pool-a"],
  },
  {
    id: "review",
    treatment: "studio-node studio-node--llm",
    typeLine: "◆Review",
    chips: ["prompt template", "coder-max"],
  },
  {
    id: "checks-green",
    treatment: "studio-node studio-node--flow",
    typeLine: "◇Gate",
    chips: ["required checks: 3"],
  },
  {
    id: "open-pr",
    treatment: "studio-node studio-node--term",
    typeLine: "●Terminal",
    chips: ["squash · delete branch"],
  },
];

/** The four labelled edges, their pills and the tone each takes from its condition. */
export const SEEDED_LABELS: readonly {
  readonly edge: string;
  readonly text: string;
  readonly tone: string;
}[] = [
  { edge: "effort-recheck→plan", text: "≤ M ↓", tone: "studio-edge-label--accent" },
  { edge: "effort-recheck→split", text: "> M ↘", tone: "studio-edge-label--warn" },
  { edge: "checks-green→open-pr", text: "pass →", tone: "studio-edge-label--ok" },
  { edge: "checks-green→implement", text: "fail ↺", tone: "studio-edge-label--err" },
];

/** The ouroboros edge: the gate's failure, back to implement. */
export const LOOP_EDGE = "checks-green→implement";

/** The stage mockup 04 draws selected, with the `.sel` ring. */
export const SELECTED_STAGE = "implement";

/**
 * `--accent-deep` in each palette, as the browser computes a stroke — `app/tokens.css`'s
 * `#055872` and `#1793c4`. What the loop edge must be drawn in, proving the token reaches an SVG
 * path in both palettes rather than the library's grey.
 */
export const ACCENT_DEEP = { light: "rgb(5, 88, 114)", dark: "rgb(23, 147, 196)" } as const;

/**
 * Mockup 04's four accent edges — trigger → analyze → decision → plan → implement — as the canvas names
 * its edges. S.6's dry run of the seeded `standard-fix` for `#485`
 * ([#152](https://github.com/NobuData/ouroboros/issues/152)) must paint every one of them: they are the
 * prefix of the engine's walk, which `ouroboros-engine`'s own suite asserts.
 */
export const MOCKUP_ACTIVE_EDGES = [
  "issue-queued→analyze",
  "analyze→effort-recheck",
  "effort-recheck→plan",
  "plan→implement",
] as const;

/** An edge the walk does not take: the decision's `> M ↘` branch, which `#485` (effort M) does not satisfy. */
export const NOT_TAKEN_EDGE = "effort-recheck→split";

/** The head's action (`app/workflows/view.ts`'s `DRY_RUN_LABEL`). */
export const DRY_RUN_LABEL = "Dry run";

/** The picker dialog's title (`app/workflows/dry-run.ts`'s `DRY_RUN_DIALOG_TITLE`). */
export const DRY_RUN_DIALOG_TITLE = "Dry run";

/** The picker's label. */
export const TICKET_LABEL = "Issue";

/** The picker's primary action. */
export const RUN_LABEL = "Run dry run";

/** What the picker opens on: the seeded `#485`, whatever the backlog lists around it. */
export const SEEDED_TICKET = /^#485 · .* · effort M$/;

/** The step sheet's name — mockup 04's action, for the ticket walked. */
export const DRY_RUN_SHEET_TITLE = "Dry run with issue #485";

/* ------------------------------------------------------------------ S.8: the frame around the canvas */

/** One entry of the workflow rail, as the seed makes it draw. */
export interface SeededRailEntry {
  /** The workflow's name — the seed sets it to the slug, as mockup 04's rail and head both print. */
  readonly name: string;
  /** P.4's composed caption, printed as served. */
  readonly caption: string;
  /** Whether the entry carries the err-dot — `paused`, and nothing else. */
  readonly paused: boolean;
}

/**
 * The rail, top to bottom — P.4 lists by `created_at`, oldest first, which is mockup 04's order.
 *
 * `standard-fix` reads **12** stages where the mockup's caption reads 6: a stage is a node, and the
 * version in force has twelve. `R__dev_seed_workflows.sql`'s header settles that in the document's
 * favour, and this is where the leg holds the rail to the settlement.
 */
export const SEEDED_RAIL: readonly SeededRailEntry[] = [
  { name: "standard-fix", caption: "12 stages · auto-merge", paused: false },
  { name: "feature-loop", caption: "7 stages · auto-merge", paused: false },
  { name: "deps-refresh", caption: "5 stages · needs review", paused: false },
  { name: "docs-loop", caption: "4 stages · auto-merge", paused: false },
  { name: "hotfix-p0", caption: "5 stages · paused", paused: true },
];

/** The rail's accessible name (`app/workflows/view.ts`'s `RAIL_LABEL`). */
export const RAIL_LABEL = "Workflows";

/** The segmented control's accessible name — the studio's eyebrow (`STUDIO_EYEBROW`). */
export const STUDIO_SUBNAV_LABEL = "Workflow Studio";

/** The inspector panel's accessible name (`app/workflows/inspector/inspector.ts`). */
export const INSPECTOR_LABEL = "Inspector";

/**
 * What the inspector draws for *Implement*, the stage mockup 04 opens selected.
 *
 * Every value is the seeded document's `implement` node read through R.3's catalog schema, except
 * `model`, which is a *route's* answer: the stage inherits the `implement` task, whose primary hop
 * is `coder-max`, bound to `claude-fable-5` (`support/routing.ts`). The pill is therefore three
 * services deep, which is why parity asserts it.
 */
export const IMPLEMENT_INSPECTOR = {
  role: "Implement",
  title: "Code the change",
  description: "Writes the change described by the attack plan onto a fresh branch.",
  skill: "zephyr-conventions",
  promptStart: "Implement the approved plan.",
  inherit: /^Inherit route for task "implement"/,
  task: "implement",
  model: "claude-fable-5",
  retries: "2",
  budget: "400k",
  permissions: [
    { name: "May push fixup commits", on: true },
    { name: "May touch CI config", on: false },
  ],
} as const;

/** *Implement*'s chips as seeded: its skill, and the route it inherits. */
export const IMPLEMENT_CHIPS = ["skill:zephyr-conventions", "routed by task"] as const;

/** The skill the edit test writes into *Implement* — one the workspace lists, so no warning is drawn. */
export const EDITED_SKILL = "repo-map";

/** The chips *Implement* must print once {@link EDITED_SKILL} is applied. */
export const EDITED_CHIPS = [`skill:${EDITED_SKILL}`, "routed by task"] as const;

/** The inspector's footer, and the canvas toolbar's save line (`inspector.ts`, `autosave.ts`). */
export const APPLY_LABEL = "Apply";
export const DELETE_STAGE_LABEL = "Delete stage";
export const CLEAN_REASON = "Nothing to apply yet.";
export const DIRTY_NOTE = "Unapplied changes";
export const SAVED_NOTE = "All changes saved.";

/** Why a member's inspector controls are inert (`inspector.ts`'s `MEMBER_REASON`). */
export const MEMBER_EDIT_REASON = "Only an owner or admin may change a workflow.";

/** Why a member's **+ New workflow** tile is inert (`view.ts`'s `NEW_WORKFLOW_MEMBER_REASON`). */
export const MEMBER_CREATE_REASON = "Creating a workflow is for workspace owners and admins.";

/** The rail's tile. */
export const NEW_WORKFLOW_LABEL = "+ New workflow";

/** The read-only note a member is served, head and body (`states.ts`'s `readOnlyNote`). */
export const MEMBER_READ_ONLY_NOTE =
  "Viewing the studio as a member. Workflows are created, edited and published by an owner or " +
  "an admin. Everything here can be read; nothing here can be changed.";

/* ------------------------------------------------------------------ S.8: publishing */

/**
 * The head's primary action — *Publish v15* beside a `v14` chip — with the number captured.
 *
 * The number is **read, never written down**. Publishing is append-only: every green run of this leg
 * freezes one more version of `standard-fix`, so the next is v15 on a cold stack and v16 on the one
 * after it. The leg asserts the step — the number after is the number before, plus one — which is
 * what a publish *is*, and is equally true on both.
 */
export const PUBLISH_LABEL = /^Publish v(\d+)$/;

/**
 * The version a head action publishes.
 *
 * @param label - The action's label, `Publish v15`.
 * @returns `15`.
 * @throws {Error} If the label is not a publish action's.
 */
export function publishedVersion(label: string): number {
  const match = PUBLISH_LABEL.exec(label);

  if (match === null) throw new Error(`"${label}" is not a Publish vN label`);

  return Number(match[1]);
}

/** The findings list's accessible name (`app/workflows/publish.ts`). */
export const FINDINGS_LABEL = "Validation findings";

/** The studio's refusal headline over a list of findings (`app/workflows/publish.ts`). */
export const FINDINGS_MESSAGE =
  "This definition cannot be published yet. Select a finding to go to the stage it is about — " +
  "nothing was published.";

/**
 * The sabotage the publish test arranges, and the one finding the gate must answer with.
 *
 * *Implement* pins `coder-maxx` where the seed inherits a route. A draft accepts it — decision P7
 * makes an unknown alias a warning while editing — and CH.6's gate promotes it to a finding at
 * publish, anchored to the stage and offering the alias one letter away. It is chosen over the
 * registry leg's raw model id so the two legs certify different refusals, and because the repair
 * is a control a reader presses: choosing *Inherit route* again puts the seeded config back exactly.
 */
export const SABOTAGE = {
  stage: "implement",
  stageTitle: "Code the change",
  alias: "coder-maxx",
  message:
    "Stage `implement` pins `coder-maxx`, which is not in this workspace's model registry — " +
    "reference a registry alias (did you mean coder-max?).",
} as const;

/** The change note the repaired publish carries. */
export const REPAIR_NOTE = "Implement inherits its task's route again (e2e, S.8).";

/**
 * The toast a publish that took leaves (`app/workflows/publish.ts`'s `publishedToast`).
 *
 * @param version - The number now in force.
 * @returns The sentence.
 */
export function publishedToast(version: number): string {
  return `Published v${version}. Runs queued from now on use it.`;
}

/* ------------------------------------------------------------------ the draft, over the API */

/** `standard-fix` — `workflows.id`, literal in `R__dev_seed_workflows.sql` (the rail's first). */
export const STANDARD_FIX_ID = "5eed001b-0000-4000-8000-000000000001";

/** The studio's route for it, and its `<h1>` — the shape the registry leg's governance test reads. */
export const STANDARD_FIX = { path: STUDIO_PATH, title: STUDIO_TITLE } as const;

/** The workflow's resource on the API. */
const STANDARD_FIX_API = `/api/v1/workflows/${STANDARD_FIX_ID}`;

/**
 * The seeded `standard-fix` document — the committed DSL fixture the seed copies byte for byte.
 *
 * **Read from the fixture rather than written out**, and that is not the rule `support/seed.ts`
 * argues against: this is the seed's own *input*, which `tests/seed.test.sh` in `ouroboros-db`
 * holds identical to the seeded draft, not a payload the product under test produced. Copying
 * three hundred lines of it into this file would be a second copy for that test to miss. It is
 * the value a restore puts back, never one read off the stack.
 *
 * @returns A fresh copy of the document.
 */
export function seededDefinition(): Record<string, unknown> {
  const fixture = resolve(
    __dirname,
    "../../../schemas/workflow-dsl/fixtures/valid/standard-fix.json",
  );

  return JSON.parse(readFileSync(fixture, "utf8")) as Record<string, unknown>;
}

/**
 * Write `standard-fix`'s draft, guarded by the etag the service currently holds.
 *
 * `PUT …/draft` requires `If-Match` (P.4), which `support/rest.ts`'s helpers do not send: the
 * etag is read immediately before the write, so this is *the latest draft, replaced*, which is
 * what an arrangement and a restore both mean.
 *
 * @param context - The context to act for. Its person must be an `owner` or an `admin`.
 * @param definition - The whole document.
 * @param what - What the write is for, for the failure message.
 * @returns When the service has stored it.
 * @throws {Error} If either request was refused, with the status and the body.
 */
export async function writeStandardFixDraft(
  context: BrowserContext,
  definition: Record<string, unknown>,
  what: string,
): Promise<void> {
  const detail = await requestAs<{ draft: { etag: string } }>(
    context,
    "GET",
    STANDARD_FIX_API,
    null,
    what,
  );
  const token = await sessionTokenOf(context, what);

  const response = await fetch(`${REST_URL}${STANDARD_FIX_API}/draft`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${token}`,
      "if-match": detail?.draft.etag ?? "",
    },
    body: JSON.stringify({ definition }),
  });

  if (!response.ok) {
    throw new Error(`${what} answered ${response.status}: ${await response.text()}`);
  }
}

/**
 * Put `standard-fix`'s draft back exactly as the seed wrote it.
 *
 * @param context - The context to act for.
 * @returns When the restore has been attempted. It never throws — see `support/rest.ts`.
 */
export function restoreStandardFixDraft(context: BrowserContext): Promise<void> {
  return quietly(
    () => writeStandardFixDraft(context, seededDefinition(), "restoring standard-fix's draft"),
    "standard-fix's draft was not restored — the studio's canvas, the code view's file and " +
      "both their screenshot pairs start from a document nobody seeded.",
  );
}

/**
 * Pin {@link SABOTAGE}'s stage to its unknown alias, in `standard-fix`'s draft.
 *
 * @param context - The context to act for. Its person must be an `owner` or an `admin`.
 * @returns When the draft holds the sabotage.
 * @throws {Error} If the seeded document has no such stage, or the write was refused.
 */
export async function sabotageDraft(context: BrowserContext): Promise<void> {
  const definition = seededDefinition();
  const nodes = definition.nodes as { id: string; config: Record<string, unknown> }[];
  const node = nodes.find((candidate) => candidate.id === SABOTAGE.stage);

  if (node === undefined) throw new Error(`standard-fix has no ${SABOTAGE.stage} stage`);

  node.config = { ...node.config, routing: { pinned_model: { alias: SABOTAGE.alias } } };

  await writeStandardFixDraft(
    context,
    definition,
    `pinning ${SABOTAGE.stage} to ${SABOTAGE.alias}`,
  );
}

/**
 * Ask the service to publish `standard-fix` with this context's session, and report its answer.
 *
 * **Not a helper that insists**, unlike `support/rest.ts`'s: the member test calls it to observe a
 * refusal, so the status is the result rather than a reason to throw. A `403` is the answer the role
 * gate owes a member; anything else — a `200` above all — is the leg's finding.
 *
 * @param context - The context to act for.
 * @returns The HTTP status the publish route answered.
 */
export async function publishStatusFor(context: BrowserContext): Promise<number> {
  const token = await sessionTokenOf(context, "publishing standard-fix");

  const response = await fetch(`${REST_URL}${STANDARD_FIX_API}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify({}),
  });

  return response.status;
}
