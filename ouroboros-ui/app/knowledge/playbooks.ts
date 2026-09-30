/**
 * Every sentence the playbooks card says, and every decision it makes that is not a write
 * (BG.4, [#420](https://github.com/NobuData/ouroboros/issues/420)) — mockup 14's `3 recipes`,
 * **Run on issue… ▾** and the dashed **+ New playbook from a past run…** tile.
 *
 * **Framework-free and pure**, like `app/knowledge/facts.ts`: the card, the two dialogs and the
 * tests read from here, so the copy is written once and the row the reader sees is the row the
 * suite asserts.
 *
 * ### The run count is a credibility signal, so it is never invented
 *
 * `run 9×` is the service's count of the runs that carry the playbook's id (decision **K6**). A
 * launch from this card is a **queue write**; the count moves when a run opens for it, which is
 * ingest's move and not this page's. So a fresh launch is drawn beside the count as *#485 queued*
 * with that explanation, and the count itself is never incremented by hand.
 *
 * ### The picker is ranked, and says why a row cannot launch
 *
 * The service narrows **Run on issue… ▾** to the open issues the playbook's filter admits
 * ([#415](https://github.com/NobuData/ouroboros/issues/415)); this file **ranks** them by how
 * safely a launch would land — a sized issue the queue does not hold yet first, then the ones
 * still being sized, then those nobody has sized, then those whose sizing needs a person, and
 * last the ones already queued — and gives each row that cannot launch its reason, so the
 * dropdown is never a blind list ({@link rankCandidates}).
 *
 * ### A launch leaves a receipt
 *
 * A dropdown that appears to do nothing is indistinguishable from a broken one, so a launch's
 * answer is written out — what was queued, under which pin, at which position — with links to the
 * dashboard's queue and the issues page ({@link receiptToast}).
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import type {
  CreatePlaybookFromRunBody,
  Playbook,
  PlaybookDraft,
  PlaybookIssueCandidate,
  PlaybookLaunchReceipt,
} from "@/app/api/playbooks";
import type { RunSummary } from "@/app/api/dashboard";
import type { SkillSummary } from "@/app/api/skills";
import { coarseAgo } from "@/app/format";
import { DASHBOARD_PATH, DASHBOARD_QUEUE_HASH, ISSUES_PATH, runPath } from "@/app/paths";

import { KNOWLEDGE_ORIGIN_ID } from "./facts";
import type { KnowledgeToast } from "./toast";

/* ------------------------------------------------------------------ the card */

/**
 * The head's count — the mockup's `3 recipes`.
 *
 * @param count How many playbooks the workspace has.
 * @returns `3 recipes`, `1 recipe`.
 */
export function recipesChip(count: number): string {
  return `${String(count)} ${count === 1 ? "recipe" : "recipes"}`;
}

/**
 * The count beside a name — the mockup's `run 9×`.
 *
 * @param count The runs launched through the playbook.
 * @returns `run 9×`.
 */
export function runCountLabel(count: number): string {
  return `run ${String(count)}×`;
}

/** What the count measures, in its tooltip and in the accessibility tree. */
export const RUN_COUNT_NOTE =
  "Counted from the runs launched through this playbook. A queued launch counts once its run opens.";

/** The row's action. */
export const RUN_ON_ISSUE = "Run on issue… ▾";

/** The dashed tile. */
export const NEW_PLAYBOOK = "+ New playbook from a past run…";

/** The card when the list could not be read. */
export const PLAYBOOKS_UNREAD_TITLE = "The playbooks could not be read.";

/** The card with no recipes. */
export const NO_PLAYBOOKS_TITLE = "No playbooks yet.";

/** What fills it, and how — the create-from-run path is the primary action beneath. */
export const NO_PLAYBOOKS_NOTE =
  "A playbook is a run that went well, kept: its workflow pin, its skill overrides and its steer " +
  "notes, aimed at any issue the picker offers. Create the first one from a run that finished.";

/** Why a viewer's **Run on issue… ▾** is inert — the queue write's own gate. */
export const LAUNCH_VIEWER_REASON =
  "Only an owner, an admin or a member can run a playbook on an issue; a viewer reads.";

/** Why a member's **+ New playbook from a past run…** is inert — the gate writing a skill takes. */
export const CREATE_ADMIN_REASON =
  "Only an owner or an admin can create a playbook — it changes which skills a run is injected with.";

/**
 * What the playbook's filter admits, under its description.
 *
 * @param playbook The playbook.
 * @returns `Offers every open issue.`, or the labels and repositories it narrows to.
 */
export function filterLine(playbook: Playbook): string {
  const filter = playbook.issueFilter;
  if (filter === null) return "Offers every open issue.";

  const parts: string[] = [];
  if (filter.labels !== null && filter.labels.length > 0) parts.push(`labelled ${filter.labels.join(" or ")}`);
  if (filter.repos !== null && filter.repos.length > 0) parts.push(`in ${filter.repos.join(" or ")}`);

  return parts.length === 0 ? "Offers every open issue." : `Offers open issues ${parts.join(" · ")}.`;
}

/**
 * The pin a playbook runs under — the mockup's `standard-fix@v14`, in words.
 *
 * @param workflow The pinned workflow.
 * @returns `standard-fix v14`.
 */
export function pinLabel(workflow: Playbook["workflow"]): string {
  return `${workflow.slug} v${String(workflow.version)}`;
}

/* ------------------------------------------------------------------ the picker */

/**
 * The picker dialog's name.
 *
 * @param playbook The playbook.
 * @returns `Run Flaky test hunt on an issue`.
 */
export function pickerTitle(playbook: Playbook): string {
  return `Run ${playbook.name} on an issue`;
}

/** What the picker is, under its title. */
export const PICKER_NOTE =
  "Open issues this playbook's filter admits, safest first: sized issues the queue does not hold " +
  "yet, then the rest with why they cannot launch. Queuing runs the playbook's pinned workflow on " +
  "the issue with its overrides and steer notes attached.";

/** The search box. */
export const PICKER_SEARCH_LABEL = "Find an issue";
export const PICKER_SEARCH_HINT = "A word of the title, or a number — 485 or #485. Enter searches.";
export const PICKER_SEARCH = "Search";
export const PICKER_SEARCH_MAX = 200;

/** While the candidates are read. */
export const PICKER_LOADING = "Reading the issues…";

/** The picker with nothing to offer. */
export const PICKER_EMPTY = "No open issue this playbook's filter admits.";

/**
 * The picker with nothing matching a search.
 *
 * @param q The search.
 * @returns The sentence.
 */
export function pickerEmptyFor(q: string): string {
  return `No admitted issue matches ${q}.`;
}

/**
 * The picker when the candidates could not be read.
 *
 * @param refusal The service's envelope.
 * @returns The sentence.
 */
export function pickerFailure(refusal: ErrorEnvelope): string {
  return `The issues could not be read: ${refusal.message.replace(/\.$/, "")}.`;
}

/** A row's action, and its in-flight label. */
export const LAUNCH = "Queue";
export const LAUNCHING = "Queuing…";

/** The picker's close. */
export const PICKER_CLOSE = "Close";

/** Why a candidate cannot launch, by what stops it. */
export const CANDIDATE_REASONS = {
  queued: "already in the queue",
  estimating: "being sized — try again in a moment",
  unsized: "not sized yet — the estimator has not looked at it",
  needs_human: "sizing needs a person before a loop can take it",
} as const;

/** One candidate, ranked. */
export interface RankedCandidate {
  /** The issue as the service listed it. */
  readonly candidate: PlaybookIssueCandidate;
  /** Whether a launch would land: sized, and not already queued. */
  readonly launchable: boolean;
  /** Why not, when it would not; `null` when it would. */
  readonly reason: string | null;
}

/** The rank of each thing that stops a launch — lower is safer. */
const RANK: Record<keyof typeof CANDIDATE_REASONS, number> = {
  estimating: 1,
  unsized: 2,
  needs_human: 3,
  queued: 4,
};

/**
 * What stops a candidate launching, or nothing.
 *
 * @param candidate The issue.
 * @returns The key, or `null` for a launchable one.
 */
function blocker(candidate: PlaybookIssueCandidate): keyof typeof CANDIDATE_REASONS | null {
  if (candidate.queued) return "queued";
  if (candidate.sizingStatus === "sized") return null;

  return candidate.sizingStatus;
}

/**
 * Rank the picker's candidates safest first — the service's order (newest first) kept within a
 * rank.
 *
 * @param items The candidates as the service listed them.
 * @returns The rows, launchable ones first, each unlaunchable one carrying its reason.
 */
export function rankCandidates(items: readonly PlaybookIssueCandidate[]): readonly RankedCandidate[] {
  return items
    .map((candidate, index) => {
      const key = blocker(candidate);

      return {
        row: {
          candidate,
          launchable: key === null,
          reason: key === null ? null : CANDIDATE_REASONS[key],
        },
        rank: key === null ? 0 : RANK[key],
        index,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.row);
}

/**
 * A candidate's line — `#485 — Watchdog reset on I²C bus lockup`.
 *
 * @param candidate The issue.
 * @returns The line.
 */
export function candidateLine(candidate: PlaybookIssueCandidate): string {
  return `#${String(candidate.number)} — ${candidate.title}`;
}

/**
 * A candidate's action name — what pressing Queue on this row does.
 *
 * @param candidate The issue.
 * @returns `Queue #485`.
 */
export function launchName(candidate: PlaybookIssueCandidate): string {
  return `${LAUNCH} #${String(candidate.number)}`;
}

/**
 * What a refused launch says, in the row.
 *
 * @param refusal The service's envelope.
 * @returns The sentence.
 */
export function launchFailure(refusal: ErrorEnvelope): string {
  if (refusal.code === "forbidden") return `Not queued: ${LAUNCH_VIEWER_REASON}`;
  if (refusal.code === "queue_issues_conflict") return "Not queued: the queue already holds this issue.";
  if (refusal.code === "queue_issues_not_queueable") return "Not queued: the issue is not sized yet.";
  if (refusal.code === "playbook_issue_filtered") return "Not queued: this playbook's filter no longer admits the issue.";
  if (refusal.code === "queue_workflow_unknown") return "Not queued: the playbook's workflow is no longer active.";

  return `Not queued: ${refusal.message.replace(/\.$/, "")}.`;
}

/**
 * The receipt's sentence — what was queued, under which pin, at which position.
 *
 * @param receipt What the service answered.
 * @param playbook The playbook it ran.
 * @returns The sentence.
 */
export function receiptText(receipt: PlaybookLaunchReceipt, playbook: Playbook): string {
  const { item } = receipt;
  const pin = item.workflowVersion === null ? item.workflowTag : `${item.workflowTag} v${String(item.workflowVersion)}`;

  return (
    `Queued #${String(item.issueNumber)} — ${item.issueTitle} — under ${playbook.name} (${pin}), ` +
    `position ${String(receipt.position)} in the queue.`
  );
}

/** Where the receipt points: the dashboard's queue card, and the issues page. */
export const RECEIPT_LINKS: readonly KnowledgeToast["links"][number][] = [
  { label: "Queue on the dashboard", href: `${DASHBOARD_PATH}#${DASHBOARD_QUEUE_HASH}` },
  { label: "Issues", href: ISSUES_PATH },
];

/**
 * The toast a launch leaves on the page.
 *
 * @param receipt What the service answered.
 * @param playbook The playbook it ran.
 * @returns The toast.
 */
export function receiptToast(receipt: PlaybookLaunchReceipt, playbook: Playbook): KnowledgeToast {
  return { text: receiptText(receipt, playbook), links: RECEIPT_LINKS };
}

/**
 * What a row says beside its count after a launch from this page — honest about what the count
 * measures.
 *
 * @param receipts The launches made from this row since the page was read.
 * @returns `#485 queued`, `#485, #490 queued`, or `null` with none.
 */
export function queuedNote(receipts: readonly PlaybookLaunchReceipt[]): string | null {
  if (receipts.length === 0) return null;

  return `${receipts.map((receipt) => `#${String(receipt.item.issueNumber)}`).join(", ")} queued`;
}

/** What the queued note means — beside it, and in the accessibility tree. */
export const QUEUED_NOTE_DETAIL = "Counts once its run opens.";

/* ------------------------------------------------------------------ create from a run */

/** The dialog's name. */
export const NEW_PLAYBOOK_TITLE = "New playbook from a past run";

/** What it does, under its title. */
export const NEW_PLAYBOOK_NOTE =
  "A playbook is learned from a run that finished: its workflow pin, the skills it was injected " +
  "with beyond what assembly would give today, and the steer notes it carried. What was captured " +
  "is shown before anything is saved.";

/** The first step. */
export const RUNS_LEGEND = "Recent runs that finished";
export const RUNS_LOADING = "Reading recent runs…";
export const NO_RUNS = "No run has finished yet — a playbook is learned from one that has.";
export const CHOOSE_RUN = "Use this run";
export const CHANGE_RUN = "Choose another run";

/** How many terminal runs the picker reads. */
export const RUNS_LIMIT = 25;

/**
 * The runs could not be read.
 *
 * @param refusal The service's envelope.
 * @returns The sentence.
 */
export function runsFailure(refusal: ErrorEnvelope): string {
  return `Recent runs could not be read: ${refusal.message.replace(/\.$/, "")}.`;
}

/**
 * A run's line — `#482 — Fix flaky CAN-bus telemetry test`.
 *
 * @param run The run.
 * @returns The line.
 */
export function runLine(run: RunSummary): string {
  return `#${String(run.issueNumber)} — ${run.issueTitle}`;
}

/**
 * A run's meta — `standard-fix · merged · 42m ago`.
 *
 * @param run The run.
 * @param now The instant the page was read.
 * @returns The line.
 */
export function runMeta(run: RunSummary, now: Date): string {
  const ended = run.finishedAt === null ? "still running" : coarseAgo(run.finishedAt, now);

  return `${run.workflowTag} · ${run.status.replace("_", " ")} · ${ended}`;
}

/**
 * A run's console, opened from this page.
 *
 * @param run The run.
 * @returns The path.
 */
export function runConsolePath(run: RunSummary): string {
  return runPath(run.id, KNOWLEDGE_ORIGIN_ID);
}

/**
 * The action name for choosing a run.
 *
 * @param run The run.
 * @returns `Use this run: #482`.
 */
export function chooseRunName(run: RunSummary): string {
  return `${CHOOSE_RUN}: #${String(run.issueNumber)}`;
}

/** The second step. */
export const DRAFT_LOADING = "Reading what the run captured…";
export const CAPTURED_LEGEND = "What the run captured";
export const PIN_LABEL = "Workflow pin";
export const OVERRIDES_LABEL = "Skill overrides";
export const STEERS_LABEL = "Steer notes";
export const NO_OVERRIDES = "none — the run was injected with exactly what assembly resolves today";
export const NO_STEERS = "none — nobody steered the run";

/**
 * The draft could not be read.
 *
 * @param refusal The service's envelope.
 * @returns The sentence.
 */
export function draftFailure(refusal: ErrorEnvelope): string {
  if (refusal.code === "playbook_run_not_terminal") return "This run has not finished; a playbook is learned from one that has.";
  if (refusal.code === "playbook_run_unpinned") return "This run has no published workflow version a playbook could pin.";

  return `The run could not be read: ${refusal.message.replace(/\.$/, "")}.`;
}

/**
 * Where the draft's parts came from — `derived against acme-robotics/helios-firmware from 3
 * injection records and 2 steers`.
 *
 * @param draft The draft.
 * @returns The sentence.
 */
export function derivedLine(draft: PlaybookDraft): string {
  const { repo, injections, steers } = draft.derivedFrom;
  const records = `${String(injections)} injection ${injections === 1 ? "record" : "records"}`;
  const steered = `${String(steers)} ${steers === 1 ? "steer" : "steers"}`;

  return `Loop #${String(draft.sourceLoopSeq)} — derived against ${repo} from ${records} and ${steered}.`;
}

/** What one half of the override delta names. */
export interface OverrideLines {
  /** The skills re-admitted, by slug (or id when the page did not read the skill). */
  readonly enable: readonly string[];
  /** The skills left out, likewise. */
  readonly disable: readonly string[];
}

/**
 * The override delta, with each skill named by the slug the page read.
 *
 * @param draft The draft.
 * @param skills The workspace's skills, or `null` when they could not be read.
 * @returns The two lists.
 */
export function overrideLines(draft: PlaybookDraft, skills: readonly SkillSummary[] | null): OverrideLines {
  const byId = new Map((skills ?? []).map((skill) => [skill.id, skill.slug]));
  const name = (id: string): string => byId.get(id) ?? id;

  return {
    enable: draft.skillOverrides.enable.map(name),
    disable: draft.skillOverrides.disable.map(name),
  };
}

/** The naming step. */
export const NAME_LABEL = "Name";
export const NAME_HINT = "How the card lists it — the mockup's Flaky test hunt.";
export const NAME_MAX = 120;
export const NAME_REQUIRED = "Give the playbook a name.";
export const NAME_LONG = `At most ${String(NAME_MAX)} characters.`;
export const NAME_TAKEN = "This workspace already has a playbook with that name.";
export const DESCRIPTION_LABEL = "Description";
export const DESCRIPTION_HINT = "One line under the name; the run's own is suggested.";
export const DESCRIPTION_MAX = 300;
export const DESCRIPTION_LONG = `At most ${String(DESCRIPTION_MAX)} characters.`;
export const LABELS_LABEL = "Only offer issues labelled";
export const LABELS_HINT = "Optional — labels, comma-separated; the picker then offers issues carrying one of them. Empty offers every open issue.";
export const LABELS_MAX = 32;
export const LABELS_MANY = `At most ${String(LABELS_MAX)} labels.`;
export const CREATE_SUBMIT = "Save playbook";
export const CREATE_CANCEL = "Cancel";
export const CREATING = "Saving…";

/** The form as the reader fills it. */
export interface PlaybookForm {
  readonly name: string;
  readonly description: string;
  /** The labels, as typed — comma-separated. */
  readonly labels: string;
}

/** What is wrong with the form, by field. */
export interface PlaybookFormProblems {
  readonly name?: "missing" | "long" | "taken";
  readonly description?: "long";
  readonly labels?: "many";
}

/**
 * The form a draft opens with.
 *
 * @param draft The draft.
 * @returns The form: the suggested description, nothing else.
 */
export function openingPlaybookForm(draft: PlaybookDraft): PlaybookForm {
  return { name: "", description: draft.suggestedDescription, labels: "" };
}

/**
 * The labels a comma-separated field names, trimmed and de-duplicated.
 *
 * @param typed The field.
 * @returns The labels.
 */
export function parseLabels(typed: string): readonly string[] {
  return [...new Set(typed.split(",").map((label) => label.trim()).filter((label) => label !== ""))];
}

/**
 * Check the form before a round trip.
 *
 * @param form The form.
 * @param existing The workspace's playbooks, or `null` when they could not be read (then no
 *   name is refused here — the service's `409` still lands on the box).
 * @returns The problems.
 */
export function playbookFormProblems(form: PlaybookForm, existing: readonly Playbook[] | null): PlaybookFormProblems {
  const problems: { -readonly [K in keyof PlaybookFormProblems]: PlaybookFormProblems[K] } = {};
  const name = form.name.trim();

  if (name === "") problems.name = "missing";
  else if (name.length > NAME_MAX) problems.name = "long";
  else if (existing?.some((one) => one.name.toLowerCase() === name.toLowerCase()) === true) problems.name = "taken";

  if (form.description.trim().length > DESCRIPTION_MAX) problems.description = "long";
  if (parseLabels(form.labels).length > LABELS_MAX) problems.labels = "many";

  return problems;
}

/**
 * The sentence for a name problem.
 *
 * @param problem The problem, or none.
 * @returns The sentence, or `undefined`.
 */
export function nameError(problem: PlaybookFormProblems["name"]): string | undefined {
  if (problem === "missing") return NAME_REQUIRED;
  if (problem === "long") return NAME_LONG;
  if (problem === "taken") return NAME_TAKEN;

  return undefined;
}

/**
 * Why the save cannot be pressed, or nothing.
 *
 * @param problems The problems.
 * @returns The first problem's sentence, or `undefined` when the form is sendable.
 */
export function createReason(problems: PlaybookFormProblems): string | undefined {
  return (
    nameError(problems.name) ??
    (problems.description === "long" ? DESCRIPTION_LONG : undefined) ??
    (problems.labels === "many" ? LABELS_MANY : undefined)
  );
}

/**
 * Compose the body.
 *
 * @param draft The draft — the run.
 * @param form The form.
 * @returns The body. A description equal to the suggested one is left out (the service suggests
 *   it again); an empty label field sends no filter.
 */
export function createBody(draft: PlaybookDraft, form: PlaybookForm): CreatePlaybookFromRunBody {
  const description = form.description.trim();
  const labels = parseLabels(form.labels);

  return {
    runId: draft.sourceRunId,
    name: form.name.trim(),
    ...(description !== "" && description !== draft.suggestedDescription ? { description } : {}),
    ...(labels.length > 0 ? { issueFilter: { labels: [...labels] } } : {}),
  };
}

/**
 * What a refused create says.
 *
 * @param refusal The service's envelope.
 * @returns The sentence, and which field it belongs under.
 */
export function createFailure(refusal: ErrorEnvelope): { readonly message: string; readonly field: "name" | null } {
  if (refusal.code === "playbook_name_taken") return { message: NAME_TAKEN, field: "name" };
  if (refusal.code === "forbidden") return { message: `Not saved: ${CREATE_ADMIN_REASON}`, field: null };

  return { message: `Not saved: ${refusal.message.replace(/\.$/, "")}.`, field: null };
}

/**
 * The toast a create leaves.
 *
 * @param playbook The new playbook.
 * @returns The toast — it points nowhere, since the row is on this page.
 */
export function createdToast(playbook: Playbook): KnowledgeToast {
  return {
    text: `Saved ${playbook.name} — ${pinLabel(playbook.workflow)}, ${runCountLabel(playbook.runCount)}. Run it on an issue from its row.`,
    links: [],
  };
}
