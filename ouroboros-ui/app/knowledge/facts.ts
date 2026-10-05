/**
 * Every sentence the learned-facts card says, and every decision it makes that is not a write
 * (BG.3, [#419](https://github.com/NobuData/ouroboros/issues/419)) — mockup 14's *Learned by
 * the loop* card.
 *
 * **Framework-free and pure**, like `app/knowledge/skills.ts`: the card (`facts-card.tsx`), the
 * add dialog (`add-fact.tsx`) and their suites read from here, so a row the reader sees is the
 * row the suite asserts.
 *
 * ### The card earns trust by showing its work
 *
 * - **Provenance is typed, and its links resolve.** The line under a fact is the service's —
 *   the proposer wrote it, honestly: *from correction note (run #1847)* for what BF.3 (#412)
 *   actually did, never the mockup's *from PR #514 review cycle*, which is the richer extraction
 *   BH.1 (#423) will make. The refs behind it become links exactly when there is somewhere to
 *   go: a run to its console, a pull request to its page, a ticket to its tracker (resolved by
 *   `data.ts`), an import to the file on its host. A ref with no page — a classification, a
 *   steer — is not drawn as a link to nowhere ({@link provenanceLinks}).
 * - **A confirmed fact names its decider** — *confirmed by Ken, 6w ago* — read from the audit
 *   stamp the confirm wrote, and its use count carries what it measures ({@link USED_NOTE}).
 * - **A stale fact names the anchor change that flagged it** ({@link staleLine}) — *something
 *   near this changed, please look* is a different message from *this is wrong* — and offers
 *   re-confirm and expire.
 * - **The expired row is the card's best argument**: struck through, with its reason, the use
 *   count snapshotted at expiry, and Re-learn — which makes a **new, linked proposal** and says
 *   so ({@link RELEARNED_NOTE}); the original is never resurrected.
 * - **Review all →** opens the needs-you inbox ([#466](https://github.com/NobuData/ouroboros/issues/466)),
 *   where every fact waiting on review is a card beside the rest of the queue.
 *
 * ### Who decides
 *
 * The service's rule (BF.2, #411): every member reads, `viewer` included; proposing and deciding
 * — Confirm, Reject, Re-confirm, Expire, Re-learn — are `owner`, `admin` or `member`, with the
 * session's person recorded as the actor. A viewer's actions are drawn inert with that reason,
 * and the service refuses a direct call.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import type { Fact, FactAnchorKind, FactList, FactStatus, ProposeFactBody } from "@/app/api/facts";
import { coarseAgo } from "@/app/format";
import { prPath, runPath } from "@/app/paths";
import type { ChipTone } from "@/app/ui";

import type { KnowledgeToast } from "./toast";
import type { TicketLink } from "./view";

/* ------------------------------------------------------------------ the head */

/** The head's link — the mockup's `Review all →`. */
export const REVIEW_ALL = "Review all →";


/** The head's add affordance. */
export const ADD_FACT_LABEL = "+ Add fact";

/** What the head's chip says when nothing waits and something was learned. */
export const ALL_REVIEWED = "all reviewed";

/** A chip: its text and its hue. */
export interface ChipSpec {
  readonly text: string;
  readonly tone: ChipTone;
}

/**
 * The head's chip — the mockup's `2 awaiting review`, from the counts the list carries whatever
 * the rows are; {@link ALL_REVIEWED} when nothing waits.
 *
 * @param counts Every status's count.
 * @returns The chip, or `null` for a workspace with no facts at all.
 */
export function awaitingChip(counts: FactList["counts"]): ChipSpec | null {
  if (counts.proposed > 0) return { text: `${String(counts.proposed)} awaiting review`, tone: "warn" };

  const total = counts.proposed + counts.confirmed + counts.rejected + counts.stale + counts.expired;

  return total === 0 ? null : { text: ALL_REVIEWED, tone: "neutral" };
}

/**
 * The head's second chip, when the sweep flagged something — a stale fact needs a person too.
 *
 * @param counts Every status's count.
 * @returns `1 stale`, or `null` for none.
 */
export function staleChip(counts: FactList["counts"]): ChipSpec | null {
  return counts.stale > 0 ? { text: `${String(counts.stale)} stale`, tone: "warn" } : null;
}

/* ------------------------------------------------------------------ the foot and the states */

/** The foot, verbatim. */
export const FACTS_FOOT =
  "Confirmed facts are injected into every run's context. Facts expire when the code that " +
  "taught them changes.";

/** What stands in the card when the facts could not be read. */
export const FACTS_UNREAD_TITLE = "The facts could not be read.";

/** What stands in the card when nothing has been learned. */
export const NO_FACTS_TITLE = "Nothing learned yet.";

/** Under {@link NO_FACTS_TITLE}: how facts arrive, and the one way to start now. */
export const NO_FACTS_NOTE =
  "The loop proposes facts as it works — from correction notes, waivers and steers it is told " +
  "to remember — and an import brings candidates from rules files. Add one by hand meanwhile.";

/* ------------------------------------------------------------------ the text */

/** One run of a fact's text: prose, or an inline code span. */
export interface TextPart {
  readonly kind: "text" | "code";
  readonly value: string;
}

/**
 * A fact's text split at its backticks, so `west update` renders as code as the mockup draws it.
 *
 * Backticks come in pairs; an unpaired trailing one is prose, not an open span.
 *
 * @param text The fact's text.
 * @returns The runs, in order, with no empty ones.
 */
export function codeSpans(text: string): readonly TextPart[] {
  const parts: TextPart[] = [];
  const pieces = text.split("`");

  // Even indexes are prose; odd ones are inside a pair — unless the pair never closed, which is
  // exactly the case of an odd index that is also the last piece.
  for (const [index, piece] of pieces.entries()) {
    const inside = index % 2 === 1;

    if (inside && index === pieces.length - 1) {
      parts.push({ kind: "text", value: `\`${piece}` });
      continue;
    }

    if (piece === "") continue;

    parts.push({ kind: inside ? "code" : "text", value: piece });
  }

  return parts;
}

/**
 * A fact's text with its backticks removed — for an accessible name, where a span is noise.
 *
 * @param text The fact's text.
 * @returns The plain sentence.
 */
export function plainText(text: string): string {
  return text.replaceAll("`", "");
}

/* ------------------------------------------------------------------ provenance */

/** One link under a fact: where a cited row is, or the text alone when it is nowhere. */
export interface ProvenanceLink {
  /** The link's text — `run`, `PR`, `#552`, `CLAUDE.md § Kconfig`. */
  readonly label: string;
  /** Where it goes, or `null` for a ref with no page — drawn as text, never as a dead link. */
  readonly href: string | null;
  /** Whether the destination is another site — the tracker, the host — rather than a page here. */
  readonly external: boolean;
}

/** The sidebar entry a provenance link keeps lit when it opens a run or a PR — `app/runs/origin.ts`. */
export const KNOWLEDGE_ORIGIN_ID = "knowledge";

/** What a ticket ref says when the page could not resolve it. */
export const TICKET_UNRESOLVED = "ticket (not readable)";

/**
 * One repository's segments, checked — `owner/name` and nothing else.
 *
 * @param repository The repository as the service names it.
 * @returns The two segments, or `null` for anything else — a missing link rather than a guessed
 *   one.
 */
function repoSegments(repository: string | null): readonly [string, string] | null {
  if (repository === null) return null;

  const segments = repository.split("/");
  if (segments.length !== 2 || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }

  return [segments[0]!, segments[1]!];
}

/**
 * A ticket's page on its tracker.
 *
 * Tickets are keyed on a GitHub repository and a number today (`app/runs/view.ts` says the same
 * of runs), so the tracker is GitHub's issue page.
 *
 * @param repository The repository, `owner/name`.
 * @param number The ticket's number.
 * @returns The URL, or `null` when the repository or the number cannot make one.
 */
export function ticketTrackerUrl(repository: string, number: number): string | null {
  const segments = repoSegments(repository);
  if (segments === null || !Number.isInteger(number) || number < 1) return null;

  return `https://github.com/${encodeURIComponent(segments[0])}/${encodeURIComponent(segments[1])}/issues/${String(number)}`;
}

/**
 * A rules file on its host — where an imported fact came from.
 *
 * @param repository The fact's repository, or `null` for a workspace-wide fact, which names no
 *   host to link to.
 * @param file The file's path in the repository — `CLAUDE.md`.
 * @returns The URL of the file at the default branch, or `null`.
 */
export function importFileUrl(repository: string | null, file: string): string | null {
  const segments = repoSegments(repository);
  if (segments === null || file === "") return null;

  const path = file.split("/").map((segment) => encodeURIComponent(segment)).join("/");

  return `https://github.com/${encodeURIComponent(segments[0])}/${encodeURIComponent(segments[1])}/blob/HEAD/${path}`;
}

/**
 * The links under a fact, from its typed refs.
 *
 * @param fact The fact.
 * @param tickets The tickets `data.ts` resolved, by id.
 * @returns One entry per ref that has somewhere to go, or that must say it has not — a ticket the
 *   page could not read is {@link TICKET_UNRESOLVED} as text. Refs with no page of their own (a
 *   classification, a waiver, a steer, a stage, a gate, a person) are left out: the run beside
 *   them is where a reader goes.
 */
export function provenanceLinks(fact: Fact, tickets: Readonly<Record<string, TicketLink>>): readonly ProvenanceLink[] {
  const links: ProvenanceLink[] = [];

  for (const ref of fact.provenance.refs) {
    if (ref.kind === "run" && ref.id !== undefined) {
      links.push({ label: "run", href: runPath(ref.id, KNOWLEDGE_ORIGIN_ID), external: false });
    } else if (ref.kind === "pull_request" && ref.id !== undefined) {
      links.push({ label: "PR", href: prPath(ref.id, KNOWLEDGE_ORIGIN_ID), external: false });
    } else if (ref.kind === "ticket" && ref.id !== undefined) {
      const ticket = tickets[ref.id];
      links.push(
        ticket === undefined
          ? { label: TICKET_UNRESOLVED, href: null, external: false }
          : { label: ticket.label, href: ticket.href, external: true },
      );
    } else if (ref.kind === "import" && ref.file !== undefined) {
      const label = ref.section === undefined ? ref.file : `${ref.file} § ${ref.section}`;
      links.push({ label, href: importFileUrl(fact.repoRef, ref.file), external: true });
    }
  }

  return links;
}

/* ------------------------------------------------------------------ the stamps */

/**
 * *confirmed by Ken, 6w ago* — the confirmation's actor and age, from the audit stamp.
 *
 * @param fact The fact.
 * @param now The instant the page was read.
 * @returns The phrase, `confirmed 6w ago` when the actor is gone, or `null` before a confirm.
 */
export function confirmedBy(fact: Fact, now: Date): string | null {
  const stamp = fact.confirmation;
  if (stamp === null) return null;

  const name = stamp.actor?.name ?? null;
  const ago = coarseAgo(stamp.at, now);

  return name === null ? `confirmed ${ago}` : `confirmed by ${name}, ${ago}`;
}

/**
 * The line under a fact's text — the mockup's `.fact-src`.
 *
 * @param fact The fact.
 * @param now The instant the page was read.
 * @returns The provenance line, with the confirmation after it for a confirmed or stale fact;
 *   for an expired one, {@link expiredLine} instead — the mockup replaces the source with the
 *   expiry.
 */
export function sourceLine(fact: Fact, now: Date): string {
  if (fact.status === "expired") return expiredLine(fact);

  const confirmation = fact.status === "confirmed" || fact.status === "stale" ? confirmedBy(fact, now) : null;

  return confirmation === null ? fact.provenance.line : `${fact.provenance.line} · ${confirmation}`;
}

/** What a stale fact says when the sweep recorded no reason — it never should, but the field allows it. */
export const STALE_NO_REASON = "an anchor no longer holds";

/**
 * *flagged stale 3d ago: platform_version anchor zephyr-4.0 no longer holds* — the anchor change
 * that flagged the fact, named.
 *
 * @param fact The stale fact.
 * @param now The instant the page was read.
 * @returns The line, or `null` for a fact that is not stale.
 */
export function staleLine(fact: Fact, now: Date): string | null {
  if (fact.status !== "stale" || fact.staleness === null) return null;

  return `flagged stale ${coarseAgo(fact.staleness.at, now)}: ${fact.staleness.reason ?? STALE_NO_REASON}`;
}

/**
 * *expired on Zephyr 4.1 migration · was used 31×* — the reason and the snapshot.
 *
 * @param fact The expired fact.
 * @returns The line. An expired fact with no expiry record — which the contract forbids — reads
 *   `expired`.
 */
export function expiredLine(fact: Fact): string {
  if (fact.expiry === null) return "expired";

  return `expired on ${fact.expiry.reason} · was used ${String(fact.expiry.previousUseCount)}×`;
}

/**
 * The mockup's `used 48×`.
 *
 * @param count The use count.
 * @returns The phrase.
 */
export function usedLabel(count: number): string {
  return `used ${String(count)}×`;
}

/** What the use count measures — its tooltip. */
export const USED_NOTE =
  "Manifests that carried this fact into a run's context — counted from the injection records " +
  "context assembly wrote, never typed.";

/** What an expired fact's count is — a snapshot. */
export const EXPIRED_USED_NOTE =
  "The use count as it stood when the fact expired — a snapshot, frozen since.";

/* ------------------------------------------------------------------ the status cluster */

/** The pill each status wears, as the mockup draws it. */
const STATUS_CHIP: Record<FactStatus, ChipSpec> = {
  proposed: { text: "awaiting review", tone: "warn" },
  confirmed: { text: "✓ confirmed", tone: "ok" },
  stale: { text: "stale", tone: "warn" },
  expired: { text: "expired", tone: "neutral" },
  rejected: { text: "rejected", tone: "neutral" },
};

/**
 * A fact's pill.
 *
 * @param status The status.
 * @returns The chip.
 */
export function statusChip(status: FactStatus): ChipSpec {
  return STATUS_CHIP[status];
}

/** The five verbs, as the buttons spell them. */
export const CONFIRM = "Confirm";
export const REJECT = "Reject";
export const RECONFIRM = "Re-confirm";
export const EXPIRE = "Expire";
export const RELEARN = "Re-learn";

/** The verbs, keyed by the action the service names them by. */
export type FactVerb = "confirm" | "reject" | "reconfirm" | "expire" | "relearn";

/** The button label for each verb. */
export const VERB_LABEL: Record<FactVerb, string> = {
  confirm: CONFIRM,
  reject: REJECT,
  reconfirm: RECONFIRM,
  expire: EXPIRE,
  relearn: RELEARN,
};

/**
 * The verbs a fact in a status offers — decision K3's edges, as buttons.
 *
 * @param status The status.
 * @returns The verbs, in the order the row draws them.
 */
export function verbsFor(status: FactStatus): readonly FactVerb[] {
  switch (status) {
    case "proposed":
      return ["confirm", "reject"];
    case "stale":
      return ["reconfirm", "expire"];
    case "expired":
      return ["relearn"];
    default:
      return [];
  }
}

/**
 * A button's accessible name — the verb and the fact, so two rows' Confirms read apart.
 *
 * @param verb The verb.
 * @param fact The fact.
 * @returns `Confirm: CI needs west update before first build of the day`.
 */
export function actionName(verb: FactVerb, fact: Fact): string {
  return `${VERB_LABEL[verb]}: ${plainText(fact.text)}`;
}

/** Why a viewer's actions are inert. */
export const VIEWER_REASON = "Only an owner, an admin or a member can decide a fact; a viewer reads.";

/** A row's action while its call is in flight. */
export const DECIDING = "Recording…";

/** The expire form's field, its hint, its actions, and its ceiling — the contract's 200. */
export const EXPIRE_REASON_LABEL = "Why it expired";
export const EXPIRE_REASON_HINT = "Recorded beside the expiry and shown on the row — the mockup's Zephyr 4.1 migration.";
export const EXPIRE_REASON_MAX = 200;
export const EXPIRE_SUBMIT = "Expire fact";
export const EXPIRE_CANCEL = "Keep it";
export const EXPIRE_REASON_REQUIRED = "Say why it expired.";

/** What a re-learn's row says once the new proposal exists. */
export const RELEARNED_NOTE =
  "Re-learned as a new proposal awaiting review, at the top of the card. This fact stays " +
  "expired; the new one links back to it.";

/**
 * The sentence a refused transition shows, led by what did not happen.
 *
 * @param refusal The service's envelope.
 * @returns The sentence.
 */
export function transitionFailure(refusal: ErrorEnvelope): string {
  if (refusal.code === "forbidden") return `Not changed: ${VIEWER_REASON}`;
  if (refusal.code === "fact_changed") return "Not changed: this fact moved under someone else — the page is re-reading it.";

  return `Not changed: ${refusal.message.replace(/\.$/, "")}.`;
}

/**
 * What the card announces to assistive technology once a transition lands.
 *
 * @param verb The verb that was pressed.
 * @param fact The fact as the service answered — the new proposal, for a re-learn.
 * @returns `Confirmed: CI needs west update…`.
 */
export function announcement(verb: FactVerb, fact: Fact): string {
  const done: Record<FactVerb, string> = {
    confirm: "Confirmed",
    reject: "Rejected",
    reconfirm: "Re-confirmed",
    expire: "Expired",
    relearn: "Re-learned as a new proposal",
  };

  return `${done[verb]}: ${plainText(fact.text)}`;
}

/* ------------------------------------------------------------------ the add dialog */

/** One anchor as the dialog holds it. */
export interface AnchorDraft {
  readonly kind: FactAnchorKind;
  readonly value: string;
}

/** What the dialog holds. */
export interface FactForm {
  /** The sentence. Required. */
  readonly text: string;
  /** The repository, `owner/name`, or `""` for the whole workspace. */
  readonly repoRef: string;
  /** The provenance line, or `""` for the service's `added by hand`. */
  readonly provenanceLine: string;
  /** The anchors, in order. */
  readonly anchors: readonly AnchorDraft[];
}

/** The dialog's copy. */
export const ADD_FACT_TITLE = "Add a fact";
export const ADD_FACT_NOTE =
  "It lands awaiting review, like every fact — nothing is injected until someone confirms it.";
export const ADD_FACT_SUBMIT = "Propose fact";
export const ADD_FACT_CANCEL = "Cancel";
export const PROPOSING = "Proposing…";

export const FACT_TEXT_LABEL = "Fact";
export const FACT_TEXT_HINT = "One sentence the loop should know. Backticks render as code: `west update`.";
export const FACT_TEXT_MAX = 500;
export const FACT_TEXT_REQUIRED = "Say what the loop should know.";
export const FACT_TEXT_LONG = `At most ${String(FACT_TEXT_MAX)} characters.`;

export const FACT_REPO_LABEL = "Applies to";
export const FACT_REPO_WORKSPACE = "The whole workspace";
export const FACT_REPO_UNREAD_HINT = "The enabled repositories could not be read; the fact applies to the whole workspace.";

export const FACT_PROVENANCE_LABEL = "Where it came from";
export const FACT_PROVENANCE_HINT = "Optional — the line under the fact; added by hand when left empty.";
export const FACT_PROVENANCE_MAX = 200;

export const ANCHORS_LABEL = "Anchors — why it can expire";
export const ANCHORS_HINT =
  "The nightly sweep watches each anchor: a path glob, a dependency, or a platform version. A " +
  "fact with none is never flagged stale.";
export const ANCHOR_KIND_LABEL = "Kind";
export const ANCHOR_VALUE_LABEL = "Value";
export const ADD_ANCHOR = "+ Add anchor";
export const REMOVE_ANCHOR = "Remove";
export const ANCHOR_VALUE_REQUIRED = "Give the anchor a value, or remove it.";
export const ANCHOR_DUPLICATE = "The same anchor twice.";
export const ANCHOR_VALUE_MAX = 512;

/** The three kinds, as the select spells them. */
export const ANCHOR_KIND_LABELS: Record<FactAnchorKind, string> = {
  path_glob: "Path glob",
  dependency: "Dependency",
  platform_version: "Platform version",
};

/** An example value per kind — the seed's own. */
export const ANCHOR_VALUE_EXAMPLES: Record<FactAnchorKind, string> = {
  path_glob: "tests/hil/**",
  dependency: "west",
  platform_version: "zephyr-4.0",
};

/** The kinds, in the select's order. */
export const ANCHOR_KINDS: readonly FactAnchorKind[] = ["path_glob", "dependency", "platform_version"];

/**
 * A fresh form.
 *
 * @returns Empty text, the whole workspace, no provenance, no anchors.
 */
export function openingFactForm(): FactForm {
  return { text: "", repoRef: "", provenanceLine: "", anchors: [] };
}

/**
 * The form with one more anchor.
 *
 * @param form The form.
 * @returns The form, with an empty path-glob anchor appended.
 */
export function addAnchor(form: FactForm): FactForm {
  return { ...form, anchors: [...form.anchors, { kind: "path_glob", value: "" }] };
}

/**
 * The form with one anchor changed.
 *
 * @param form The form.
 * @param index Which anchor.
 * @param anchor Its new kind and value.
 * @returns The form.
 */
export function setAnchor(form: FactForm, index: number, anchor: AnchorDraft): FactForm {
  return { ...form, anchors: form.anchors.map((one, at) => (at === index ? anchor : one)) };
}

/**
 * The form with one anchor removed.
 *
 * @param form The form.
 * @param index Which anchor.
 * @returns The form.
 */
export function removeAnchor(form: FactForm, index: number): FactForm {
  return { ...form, anchors: form.anchors.filter((_, at) => at !== index) };
}

/** What is wrong with the form, per field. */
export interface FactFormProblems {
  /** The text: missing, or over the ceiling. */
  readonly text: "required" | "long" | null;
  /** Each anchor's problem, by index, or `null`. */
  readonly anchors: readonly (string | null)[];
}

/**
 * What is wrong with the form, decided before a round trip.
 *
 * @param form The form.
 * @returns The problems. A form with none is ready to send.
 */
export function factFormProblems(form: FactForm): FactFormProblems {
  const text = form.text.trim() === "" ? "required" : form.text.length > FACT_TEXT_MAX ? "long" : null;
  const seen = new Set<string>();
  const anchors = form.anchors.map((anchor) => {
    const value = anchor.value.trim();
    if (value === "") return ANCHOR_VALUE_REQUIRED;

    const key = `${anchor.kind}:${value}`;
    if (seen.has(key)) return ANCHOR_DUPLICATE;
    seen.add(key);

    return null;
  });

  return { text, anchors };
}

/**
 * Why the submit is inert, or `undefined` when it may be pressed.
 *
 * @param problems The form's problems.
 * @returns The first problem's sentence.
 */
export function factSubmitReason(problems: FactFormProblems): string | undefined {
  if (problems.text === "required") return FACT_TEXT_REQUIRED;
  if (problems.text === "long") return FACT_TEXT_LONG;

  return problems.anchors.find((problem): problem is string => problem !== null);
}

/**
 * The body a valid form sends — empty optional fields left out, values trimmed.
 *
 * @param form The form.
 * @returns The body.
 */
export function proposeBody(form: FactForm): ProposeFactBody {
  const body: { -readonly [K in keyof ProposeFactBody]: ProposeFactBody[K] } = { text: form.text.trim() };

  if (form.repoRef !== "") body.repoRef = form.repoRef;
  if (form.provenanceLine.trim() !== "") body.provenanceLine = form.provenanceLine.trim();
  if (form.anchors.length > 0) body.anchors = form.anchors.map((anchor) => ({ kind: anchor.kind, value: anchor.value.trim() }));

  return body;
}

/** A refused proposal, as the dialog shows it: the sentence, and which anchor it was about. */
export interface ProposeFailure {
  readonly message: string;
  /** The index of the anchor the service refused, or `null` when it was not about one. */
  readonly anchorIndex: number | null;
}

/**
 * The service's refusal, turned into the dialog's sentence — under the anchor it named, when it
 * named one.
 *
 * @param refusal The envelope.
 * @param form The form as sent, to find the anchor the details name.
 * @returns The failure.
 */
export function proposeFailure(refusal: ErrorEnvelope, form: FactForm): ProposeFailure {
  if (refusal.code === "forbidden") return { message: VIEWER_REASON, anchorIndex: null };

  if (refusal.code === "fact_anchor_invalid" || refusal.code === "fact_anchor_exists") {
    const kind = refusal.details["kind"];
    const value = refusal.details["value"];
    const index = form.anchors.findIndex((anchor) => anchor.kind === kind && anchor.value.trim() === value);

    return { message: refusal.message, anchorIndex: index === -1 ? null : index };
  }

  return { message: refusal.message, anchorIndex: null };
}

/**
 * The toast a proposal leaves.
 *
 * @param fact The new proposal.
 * @returns The toast, with no links: the row is at the top of the card below.
 */
export function proposedToast(fact: Fact): KnowledgeToast {
  return {
    text: `Fact proposed: “${plainText(fact.text)}”. It is awaiting review; nothing is injected until it is confirmed.`,
    links: [],
  };
}
