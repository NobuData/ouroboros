"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, createContext, useCallback, useContext, useId, useMemo, useState } from "react";

import type { Reading } from "@/app/api/reading";
import type { CopilotPromotion } from "@/app/api/workflow-copilot";
import type { WorkflowDefinition, WorkflowRailEntry } from "@/app/api/workflows";
import { workflowPath } from "@/app/paths";
import { Button, cx } from "@/app/ui";

import { publishWorkflow } from "../draft-actions";
import { DISMISS_TOAST_LABEL, type PublishFailure, changeNoteBody, publishFailure } from "../publish";
import { PublishDialog } from "../publish-dialog";
import { discardCopilotDraft } from "./copilot-actions";
import {
  BLOCKED_HEADING,
  BLOCKERS_HEADING,
  DISCARD_LABEL,
  FLAGGED_NOTE,
  OPEN_VISUAL_LABEL,
  PROMOTE_FINDINGS_MESSAGE,
  type PromoteGate,
  RESOLVE_LABEL,
  discardFailure,
  discardReason,
  discardedNotice,
  findingStageTarget,
  flaggedHeading,
  promoteGate,
  promotedNotice,
  referenceLine,
  stageAnchorHref,
} from "./copilot-view";
import { DiscardDialog } from "./discard-dialog";
import { PromoteSummary } from "./promote-summary";

import "../workflows.css";
import "./copilot.css";

/**
 * The copilot's two head actions and what they leave behind (CE.1,
 * [#565](https://github.com/NobuData/ouroboros/issues/565)) — mockup 20's **Discard draft** and
 * **Promote draft → security-patch v1**.
 *
 * Three pieces, in the shape `app/workflows/code/code-flows-session.tsx` gave the code view's:
 *
 * - {@link CopilotFlows} wraps the page and holds the one thing the head and the body share — the
 *   sentence the last action left. The head is far from the place the sentence is drawn, and the
 *   frame between them is a Server Component, so a context carries it.
 * - {@link CopilotHeadActions} is the two buttons, the reasons beside them, and their dialogs.
 * - {@link CopilotNotice} is the sentence, above the grid.
 *
 * ### An unpublishable draft says so before the press
 *
 * Every judgement is `copilot-view.ts`' `promoteGate`. What it decides is drawn **in the page**,
 * under the buttons, and not only as the inert button's tooltip: the service's reasons, the
 * references that block by stage and by name, and the way to where they are resolved. References
 * that only flag (decision **W7**) leave the button live and are listed beside it all the same.
 *
 * ### One publish path
 *
 * Confirming a promote calls `publishWorkflow` — the Server Action the canvas's and the code
 * view's **Publish** call — through S.6's `PublishDialog`, given what is being published to state
 * above its form. A refusal stays in the dialog; a validator's findings are listed there, each a
 * link to its stage's row (`stageAnchorHref`). There is no second publish and no second dialog.
 *
 * ### After either action the page is read again
 *
 * Nothing here edits what it shows. A promote and a discard both `router.refresh()`, and the
 * server reads the promotion and the conversation again — the conversation is then `promoted` or
 * `discarded`, and the page draws it read-only because that is what was read.
 */

/** A link a notice carries — a stage the action changed, by its row's fragment. */
export interface NoticeLink {
  /** The in-page fragment — `#stage-plan` (`copilot-view.ts`' `stageAnchorHref`). */
  readonly href: string;
  /** What the link says. */
  readonly label: string;
}

/** The sentence an action left, and the links that follow it. */
interface Notice {
  readonly text: string;
  /** What leads the links — *Changed stages:*. */
  readonly linksLabel: string | null;
  readonly links: readonly NoticeLink[];
}

/** How an action leaves a sentence, with the stages it changed when it changed any. */
export type Announce = (text: string, links?: readonly NoticeLink[], linksLabel?: string) => void;

/** What the flows share between the head and the body. */
interface CopilotFlowsValue {
  /** What the last action left, or `null`. */
  readonly notice: Notice | null;
  /** Leave a sentence. */
  readonly announce: Announce;
  /** Dismiss it. */
  readonly dismiss: () => void;
}

/** The context the provider fills. */
const CopilotFlowsContext = createContext<CopilotFlowsValue | null>(null);

/**
 * The flows around one workflow's copilot page.
 *
 * Keyed by the workflow at the call site, so another workflow's page starts with no notice.
 *
 * @param props.children The page.
 * @returns The page, inside the flows.
 */
export function CopilotFlows({ children }: Readonly<{ children: ReactNode }>) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const dismiss = useCallback(() => setNotice(null), []);
  const announce = useCallback<Announce>(
    (text, links = [], linksLabel) => setNotice({ text, links, linksLabel: linksLabel ?? null }),
    [],
  );
  const value = useMemo<CopilotFlowsValue>(() => ({ notice, announce, dismiss }), [notice, announce, dismiss]);

  return <CopilotFlowsContext.Provider value={value}>{children}</CopilotFlowsContext.Provider>;
}

/**
 * How a card on this page leaves a sentence in the page's notice (CE.4,
 * [#568](https://github.com/NobuData/ouroboros/issues/568)) — the dry-run card's *Applied — the
 * draft is now v0.4.*, with the stages it changed.
 *
 * @returns The announcer; outside the flows, one that does nothing.
 */
export function useCopilotAnnounce(): Announce {
  const flows = useContext(CopilotFlowsContext);

  return flows === null ? NO_ANNOUNCE : flows.announce;
}

/** The announcer of a card drawn outside the flows. */
const NO_ANNOUNCE: Announce = () => {};

/**
 * The sentence the last action left, above the grid — the studio toast's treatment. It stays
 * until dismissed, for `studio-toast.tsx`'s reason.
 *
 * A notice may carry links to the stages its action changed. They are plain fragment anchors,
 * not router links: the stage list hears a press on one (`stage-target.ts`) and brings the row
 * into view.
 *
 * @returns The notice while there is one; nothing otherwise, and nothing outside the flows.
 */
export function CopilotNotice() {
  const flows = useContext(CopilotFlowsContext);
  if (flows === null || flows.notice === null) return null;

  const { text, links, linksLabel } = flows.notice;

  return (
    <div className="studio-toast" role="status">
      <span className="studio-toast__text">
        {text}
        {links.length > 0 && (
          <span className="copilot-view__notice-links">
            {linksLabel !== null && <> {linksLabel}</>}
            {links.map((link) => (
              <span key={link.href}>
                {" "}
                <a className="copilot-view__notice-link" href={link.href}>
                  {link.label}
                </a>
              </span>
            ))}
          </span>
        )}
      </span>
      <Button aria-label={DISMISS_TOAST_LABEL} onClick={flows.dismiss} size="sm" tone="ghost">
        ×
      </Button>
    </div>
  );
}

/** What the head's actions take. */
export interface CopilotHeadActionsProps {
  /** The open workflow's rail entry, or `null` when no workflow is open. */
  readonly entry: WorkflowRailEntry | null;
  /** The promotion summary — read, refused, or `null` when no workflow is open. */
  readonly promotion: Reading<CopilotPromotion> | null;
  /** Whether the reader's role may publish and discard — `mayAdminister`, decided at the gate. */
  readonly mayAdminister: boolean;
  /** The draft a refused promote's findings are anchored in. */
  readonly definition: WorkflowDefinition;
}

/** Which dialog is open. */
type OpenDialog = "promote" | "discard" | null;

/**
 * **Discard draft** and **Promote draft → security-patch v1**, with the reasons beside them.
 *
 * Both buttons are always drawn. One that cannot act is inert with its reason — the role's, a
 * failed read's, or the draft's own — because this page's two actions *are* its head, and a
 * reader who may do neither is told so by the buttons as well as by the read-only note.
 *
 * @param props See {@link CopilotHeadActionsProps}.
 * @returns The actions, the gate's notes, and whichever dialog is open.
 */
export function CopilotHeadActions({ entry, promotion, mayAdminister, definition }: CopilotHeadActionsProps) {
  const router = useRouter();
  const flows = useContext(CopilotFlowsContext);
  const [open, setOpen] = useState<OpenDialog>(null);

  const facts = { entry, promotion, mayAdminister };
  const gate = promoteGate(facts);
  const discardBlocked = discardReason(facts);
  const summary = promotion !== null && promotion.ok ? promotion.value : null;

  const close = useCallback(() => setOpen(null), []);

  /**
   * Publish the draft through the shared path.
   *
   * @param note The change note, as typed.
   * @returns The refusal to show, or `null` once it took.
   */
  async function promote(note: string): Promise<PublishFailure | null> {
    if (entry === null || summary === null) return null;

    const outcome = await publishWorkflow(entry.id, changeNoteBody(note));
    if (!outcome.ok) {
      const failure = publishFailure(outcome.refusal);

      // The shared sentence says *select*; on this page a finding is a link to its stage's row.
      return failure.findings.length > 0 ? { ...failure, message: PROMOTE_FINDINGS_MESSAGE } : failure;
    }

    flows?.announce(promotedNotice(summary.publishes.label));
    setOpen(null);
    // The version, the draft and the conversation all moved; the server reads them again.
    router.refresh();
    return null;
  }

  /**
   * Discard the draft.
   *
   * @returns The refusal to show, or `null` once it took.
   */
  async function discard(): Promise<string | null> {
    if (entry === null) return null;

    const outcome = await discardCopilotDraft(entry.id);
    if (!outcome.ok) return discardFailure(outcome.refusal);

    flows?.announce(discardedNotice(outcome.value.draftDiscarded));
    setOpen(null);
    router.refresh();
    return null;
  }

  return (
    <div className="copilot-view__actions">
      <div className="copilot-view__buttons">
        <Button onClick={() => setOpen("discard")} reason={discardBlocked} tone="ghost">
          {DISCARD_LABEL}
        </Button>
        <Button onClick={() => setOpen("promote")} reason={gate.reason} tone="primary">
          {gate.label}
        </Button>
      </div>

      <GateNotes gate={gate} slug={entry === null ? null : entry.slug} />

      {open === "promote" && entry !== null && summary !== null && (
        <PublishDialog
          definition={definition}
          findingTarget={findingStageTarget}
          label={gate.label}
          onClose={close}
          onPublish={promote}
          // The link is the navigation; the dialog only has to get out of its way.
          onSelect={close}
          stageHref={stageAnchorHref}
          summary={<PromoteSummary promotion={summary} />}
        />
      )}

      {open === "discard" && entry !== null && (
        <DiscardDialog currentVersion={entry.currentVersion} name={entry.name} onCancel={close} onConfirm={discard} />
      )}
    </div>
  );
}

/**
 * What stands in the way of a promote, and what is only flagged — in the page, under the buttons.
 *
 * @param props.gate The promote action, decided.
 * @param props.slug The open workflow's slug, for the way to its canvas; `null` when none is open.
 * @returns The notes, or nothing when the draft neither blocks nor flags.
 */
function GateNotes({ gate, slug }: Readonly<{ gate: PromoteGate; slug: string | null }>) {
  const ids = useId();

  if (slug === null || (!gate.draftBlocked && gate.flags.length === 0)) return null;

  return (
    <>
      {gate.draftBlocked && (
        <div
          aria-labelledby={`${ids}-blocked`}
          className={cx("copilot-view__gate", "copilot-view__gate--blocked")}
          role="group"
        >
          <p className="copilot-view__gate-title" id={`${ids}-blocked`}>
            {BLOCKED_HEADING}
          </p>
          <ul className="copilot-view__gate-list">
            {gate.reasons.map((reason, index) => (
              // The service's order is the list's; two reasons may say the same words.
              <li key={index}>{reason}</li>
            ))}
          </ul>

          {gate.blockers.length > 0 && (
            <>
              <p className="copilot-view__gate-sub">{BLOCKERS_HEADING}</p>
              <ul className="copilot-view__gate-list">
                {gate.blockers.map((reference, index) => (
                  <li key={`${reference.path}-${index}`}>
                    <span className="copilot-view__ref">{referenceLine(reference)}</span> — {reference.message}
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* A router link: the canvas is another route of this workflow, and Back returns here. */}
          <Link className="copilot-view__resolve" href={workflowPath(slug)}>
            {gate.blockers.length > 0 ? RESOLVE_LABEL : OPEN_VISUAL_LABEL}
          </Link>
        </div>
      )}

      {gate.flags.length > 0 && (
        <div
          aria-labelledby={`${ids}-flagged`}
          className={cx("copilot-view__gate", "copilot-view__gate--flagged")}
          role="group"
        >
          <p className="copilot-view__gate-title" id={`${ids}-flagged`}>
            {flaggedHeading(gate.flags.length)}
          </p>
          <ul className="copilot-view__gate-list">
            {gate.flags.map((reference, index) => (
              <li key={`${reference.path}-${index}`}>
                <span className="copilot-view__ref">{referenceLine(reference)}</span> — {reference.message}
              </li>
            ))}
          </ul>
          <p className="copilot-view__gate-foot">{FLAGGED_NOTE}</p>
        </div>
      )}
    </>
  );
}
