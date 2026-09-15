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
 */

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
