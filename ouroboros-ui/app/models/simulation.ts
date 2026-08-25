/**
 * Every decision the **Simulate routing** panel makes, as functions with inputs and outputs.
 *
 * The panel ([#203](https://github.com/NobuData/ouroboros/issues/203)) asks Z.4's
 * `POST /api/v1/routing/simulate` ([#197](https://github.com/NobuData/ouroboros/issues/197))
 * what would run for a task kind in a context, and draws the answer. What is decided here is
 * small on purpose: how the four inputs become a request, and what the panel's own copy says.
 * What is **not** decided here is any sentence about routing — every explanation the panel
 * prints is the resolution's own, rendered verbatim, because a client that narrated a chain
 * would be a second implementation of routing semantics and would drift from the first
 * (Z.1, [#194](https://github.com/NobuData/ouroboros/issues/194)).
 *
 * **Framework-free and pure**, like `app/models/rules.ts`, whose vocabulary it shares: the
 * effort scale and the diff kinds a context may carry are exactly the operands an escalation
 * rule may test, and one list for both is what keeps a simulated context from naming a fact
 * no rule could read.
 *
 * ### An absent fact is unknown, never small
 *
 * A context with no effort has not said the work is tiny; it has said nothing, and a rule
 * reading `effort_gte: "l"` does not fire on it. {@link composeSimulation} therefore **omits**
 * every fact the reader left unset — no `null`, which the contract refuses as *a client saying
 * something a context cannot mean*, and no default — and omits `ctx` altogether when there is
 * nothing in it, which is the legitimate question *what does `route.task("docs")` look like
 * before anything has sized it*.
 */

import type { Resolution, ResolutionHop, RoutingSimulationRequest } from "@/app/api/routing";

import { aliasCell } from "./matrix";
import { type DiffKind, type EffortLevel } from "./rules";

/* ------------------------------------------------------------------ the draft */

/**
 * What the panel holds while a question is being composed: one value per input.
 *
 * The two selects carry `""` for *unset*, which is the option the panel offers as *Not sized*
 * and *Not classified*; the composer turns it into an absent field rather than a value.
 */
export interface SimulationDraft {
  /** The matrix row being asked about. */
  readonly taskKind: string;
  /** How the work was sized, or `""` for work nothing has sized. */
  readonly effort: EffortLevel | "";
  /** The issue's labels, as typed — comma-separated, GitHub's spelling. */
  readonly labels: string;
  /** How the change was classified, or `""` for a change nothing has classified. */
  readonly diffKind: DiffKind | "";
}

/**
 * The panel's opening state: the route the reader was looking at, or the matrix's first,
 * and nothing known about the work.
 *
 * Nothing known is the honest default — it is the state every issue is in before the
 * estimator has seen it — and it is also the question with the plainest answer: the stored
 * chain, filtered by health and policy, with no rule firing.
 *
 * @param taskKinds The workspace's task kinds, in the matrix's order.
 * @param preferred The route the panel was opened from, or `null` when it was opened from
 *   the page head. A kind the matrix does not have is ignored rather than asked about.
 * @returns The draft.
 */
export function initialSimulation(
  taskKinds: readonly string[],
  preferred: string | null = null,
): SimulationDraft {
  const taskKind =
    preferred !== null && taskKinds.includes(preferred) ? preferred : (taskKinds[0] ?? "");

  return { taskKind, effort: "", labels: "", diffKind: "" };
}

/**
 * The labels a reader typed, as the contract's array.
 *
 * Split on commas and trimmed; empty entries are dropped so a trailing comma is not a label
 * named `""`. Case and spelling are kept exactly — labels are compared whole and
 * case-sensitively, because GitHub's own are.
 *
 * @param text The field's value.
 * @returns The labels, in the order typed. Empty for an empty field.
 */
export function splitLabels(text: string): readonly string[] {
  return text
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label !== "");
}

/**
 * The request a draft describes.
 *
 * @param draft The draft.
 * @returns The body for `POST /api/v1/routing/simulate`: the task kind, and a `ctx` holding
 *   only the facts the reader set — or no `ctx` at all when they set none.
 */
export function composeSimulation(draft: SimulationDraft): RoutingSimulationRequest {
  const labels = splitLabels(draft.labels);
  const ctx = {
    ...(draft.effort === "" ? {} : { effort: draft.effort }),
    ...(labels.length === 0 ? {} : { labels: [...labels] }),
    ...(draft.diffKind === "" ? {} : { diffKind: draft.diffKind }),
  };

  return Object.keys(ctx).length === 0
    ? { taskKind: draft.taskKind }
    : { taskKind: draft.taskKind, ctx };
}

/* ------------------------------------------------------------------ the answer */

/**
 * What a simulation answers with: the resolution, or the sentence to show instead.
 *
 * A refusal is a value rather than a throw because it is a state to render inside the panel
 * — the inputs stay, and the reason sits where the answer would have been. A `fail_run` is
 * **not** a refusal: it arrives as a resolution with `outcome: "fail_run"`, and the panel
 * draws it as the first-class outcome it is.
 */
export type SimulationReading =
  | { readonly ok: true; readonly resolution: Resolution }
  | { readonly ok: false; readonly reason: string };

/** What the panel says when the service refused the question without a sentence of its own. */
export const SIMULATE_FAILURE = "The route could not be simulated.";

/**
 * A resolved hop's — or a vote's — resolution line: the same `model · provider` the matrix
 * and the chain print for the alias, from the resolution's own facts.
 *
 * @param hop The hop, kept or dropped, or the vote — whatever names an alias, a model and
 *   where it runs.
 * @returns `claude-fable-5 · Anthropic Claude`, or `gpt-5 · no provider` for an unbound alias.
 */
export function hopResolution(hop: Pick<ResolutionHop, "alias" | "modelId" | "provider">): string {
  return aliasCell(hop).resolution;
}

/**
 * The chain the executor would walk: the kept hops, in order.
 *
 * The filter the contract leaves to the client, deliberately — dropped hops stay in the
 * array so the panel can draw them struck through with their reason.
 *
 * @param resolution The resolution.
 * @returns The kept hops.
 */
export function walkedChain(resolution: Resolution): readonly ResolutionHop[] {
  return resolution.chain.filter((hop) => hop.decision === "kept");
}

/** What the outcome heading prints, per outcome. */
const OUTCOME_LABEL: Readonly<Record<Resolution["outcome"], string>> = {
  resolved: "Resolved",
  fail_run: "The run fails",
};

/**
 * The outcome, as the panel heads its answer.
 *
 * @param outcome The resolution's outcome.
 * @returns *Resolved*, or *The run fails* — a designed outcome, in the same heading, and
 *   never an error's treatment.
 */
export function outcomeLabel(outcome: Resolution["outcome"]): string {
  return OUTCOME_LABEL[outcome];
}

/** The word beside each hop, per decision. The contract's own two words. */
export const DECISION_WORD: Readonly<Record<ResolutionHop["decision"], string>> = {
  kept: "kept",
  dropped: "dropped",
};

/**
 * The word beside a matched rule.
 *
 * @param applied Whether the rule changed the resolution.
 * @returns *applied*, or *did not apply* for a near miss — a rule whose predicate matched
 *   and which did nothing, with its own reason beside it.
 */
export function ruleWord(applied: boolean): string {
  return applied ? "applied" : "did not apply";
}

/**
 * What the panel says about the edits on the page that are not part of the answer.
 *
 * The simulation resolves the routes **as saved** — it is the same code path a run takes,
 * and a run does not see a browser's drafts — so a reader who changed a route and simulated
 * it is told the answer is about the route the server holds, not the one on their screen.
 *
 * @param pending How many routes have unsaved edits.
 * @returns The sentence, singular where the count is one.
 */
export function unsavedNote(pending: number): string {
  const changed =
    pending === 1
      ? "the route changed on this page is"
      : `the ${pending.toString()} routes changed on this page are`;

  return `The simulation runs against the routes as saved — ${changed} not part of it until Save routes.`;
}

/* ------------------------------------------------------------------ the copy */

/** The head action, the dialog's title, and the mockup's own label. */
export const SIMULATE_TITLE = "Simulate routing";

/**
 * What the dialog says about where its sentences come from — the one place the panel
 * explains itself.
 */
export const SIMULATE_NOTE =
  "Ask what would run for a task kind in a context, and be told why. Every sentence in the " +
  "answer is the resolution's own — the same code path a run takes — rendered as it arrived.";

/** The submit control. */
export const RUN_SIMULATION = "Run simulation";

/** What the submit control says, and why it is inert, while the question is on its way. */
export const SIMULATING = "Simulating…";

/** Every dialog's way out. */
export const CLOSE = "Close";

/** The first input's label. */
export const TASK_KIND_LABEL = "Task kind";

/** The effort select's label, and its unset option. */
export const EFFORT_LABEL = "Effort";
export const NOT_SIZED = "Not sized";

/** The labels field's label and hint. */
export const LABELS_LABEL = "Labels";
export const LABELS_HINT = "Comma-separated, as GitHub spells them — compared whole and case-sensitively.";

/** The diff select's label, and its unset option. */
export const DIFF_LABEL = "Diff";
export const NOT_CLASSIFIED = "Not classified";

/** The answer's section headings. */
export const CHAIN_HEADING = "Chain";
export const RULES_HEADING = "Rules that matched";
export const VOTES_HEADING = "Second opinions";
export const FLOOR_HEADING = "Floor";
export const COST_HEADING = "Max cost per run";
export const LOCAL_HEADING = "Local fallback";

/** What the rules section says when the context matched none. */
export const NO_RULES_MATCHED = "No escalation rule matched this context.";

/** What the cost row prints for a route with no cap. */
export const NO_CAP = "no cap";

/** What the local-fallback row prints, per switch position. */
export const LOCAL_ALLOWED = "allowed";
export const LOCAL_NOT_ALLOWED = "not allowed";
