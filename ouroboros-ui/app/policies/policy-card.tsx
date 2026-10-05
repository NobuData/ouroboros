"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import type { OrgPolicy } from "@/app/api/org-policy";
import type { DryRunPolicy } from "@/app/api/policies";
import type { Reading } from "@/app/api/reading";
import type { GlobPreview } from "@/app/globs/glob";
import type { SectionCommitResult } from "@/app/settings/save-model";
import { useSettingsAccess, useSettingsSection } from "@/app/settings/save-provider";
import { SectionMarks } from "@/app/settings/settings-seat";
import { sectionTitleId, settingsSection } from "@/app/settings/view";
import { Button, Card, CardHead, Tag, cx } from "@/app/ui";

import {
  loadPolicyHistory,
  previewPolicy,
  previewPolicyPaths,
  publishPolicy,
} from "./card-actions";
import {
  CUSTOM_RULE_NOTE,
  DISMISS_TOAST,
  EDIT_AS_CODE,
  EDIT_AS_CODE_SOON,
  FOOTER_LINE,
  type HistoryResult,
  NOTHING_TO_PUBLISH,
  OVERRIDE_LEAD,
  PUBLISH_CANCELLED,
  PUBLISH_NEEDS_OWNER,
  type PolicyPreview,
  type PreviewResult,
  type PublishResult,
  type PublishedToast,
  SIDE_STATES,
  SOON,
  UNPUBLISHED_NOTE,
  publishedToast,
} from "./card-view";
import {
  CORE_RULES,
  type CoreRuleId,
  type PolicyDocument,
  type PolicyDrafts,
  type PolicyRule,
  RULE_NAMES,
  composeDocument,
  draftsOf,
  ruleChips,
  validatePolicy,
  workingDocument,
} from "./document";
import { DryRunRow } from "./dry-run-row";
import { PolicyVersionTag } from "./policy-history";
import { PublishDialog, type PublishDecision } from "./publish-dialog";
import { RuleRow } from "./rule-row";
import { dryRunUnread } from "./view";

import "./policy-card.css";

/**
 * The Autonomy policies card — mockup 17's `c-7` card, tag `policy v7`
 * (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)).
 *
 * This is where a workspace changes what the product may do without asking a person, so three
 * things hold everywhere on it:
 *
 * - **The chips are the document.** Every term is drawn from the rule's conditions
 *   (`app/policies/document.ts`) and edited through a structured control — an effort select, a
 *   label list, the shared glob editor, a cents field, a stepper — so no state the evaluator
 *   cannot read can be typed, let alone published.
 * - **A save says what it loosens before it commits.** The five rules are the section's fields
 *   under the page's save model (decision S7): edits accumulate, **Save changes** counts the
 *   rules that differ, and this card's commit is *preview → confirm → publish*. The
 *   confirmation names tightening and loosening per rule in BQ.2's classification; an admin
 *   whose edit loosens a rule is told an owner must publish it, and who the owners are.
 * - **The version is something to open.** The `policy vN` tag opens the history — notes,
 *   publishers, and each version's before → after.
 *
 * ```
 * edit rules ─▶ Save changes ─▶ validate ─▶ preview (classify) ─▶ confirm ─┬─▶ publish vN+1 ─▶ toast → audit log
 *                                                                          └─▶ keep editing (edits stay unsaved)
 * ```
 *
 * A reader below admin sees the same card with every switch in its real state and every chip
 * as text. `custom:*` rules a document carries are listed read-only and published untouched.
 * The workspace-wide dry-run switch (BA.3) sits under the rules: it acts at once, behind its own
 * confirmation, and is never one of the fields a save sends.
 *
 * @param props.policy The version in force, as read.
 * @param props.dryRun The workspace-wide dry-run policy as read, or why it could not be.
 * @param props.owners The workspace's owners, by name — who an admin is told to ask.
 * @param props.actions The card's four calls. The Server Actions unless a test passes its own.
 * @returns The card.
 */
export function PolicyCard({
  policy,
  dryRun,
  owners,
  actions = SERVER_ACTIONS,
}: Readonly<{
  policy: OrgPolicy;
  dryRun: Reading<DryRunPolicy>;
  owners: readonly string[];
  actions?: PolicyCardActions;
}>) {
  const section = settingsSection("policies");
  const titleId = sectionTitleId(section.id);
  const access = useSettingsAccess();

  const working = useMemo(() => workingDocument(policy.document), [policy.document]);
  const baseline = useMemo(() => draftsOf(working), [working]);

  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [toast, setToast] = useState<PublishedToast | null>(null);

  /** The open confirmation's resolver, so an unmount can answer it rather than leave a save hanging. */
  const pending = useRef<((decision: PublishDecision) => void) | null>(null);

  useEffect(
    () => () => {
      pending.current?.({ kind: "keep-editing" });
    },
    [],
  );

  /**
   * The section's commit: preview the draft, put the confirmation in front of the reader, and
   * publish only on their word.
   *
   * @param drafts Every rule as it stands.
   * @returns Whether a version was published; when not, why — the edits stay unsaved.
   */
  async function commit(drafts: PolicyDrafts): Promise<SectionCommitResult> {
    const document = composeDocument(working, drafts);
    const checked = await actions.preview(document);

    if (!checked.ok) return { ok: false, reason: checked.reason };

    const { preview } = checked;
    if (preview.changes.length === 0) return { ok: false, reason: NOTHING_TO_PUBLISH };

    const decision = await new Promise<PublishDecision>((resolve) => {
      pending.current = resolve;
      setConfirming({ preview });
    });

    pending.current = null;
    setConfirming(null);

    if (decision.kind === "keep-editing") {
      return { ok: false, reason: preview.mayPublish ? PUBLISH_CANCELLED : PUBLISH_NEEDS_OWNER };
    }

    const published = await actions.publish(document, policy.version, decision.note);
    if (!published.ok) return { ok: false, reason: published.reason };

    setToast(publishedToast(published.version, published.summary));

    return { ok: true };
  }

  const fields = useSettingsSection<PolicyDrafts>({
    baseline,
    labels: RULE_NAMES,
    validate: (drafts) => validatePolicy(drafts),
    commit: (_changes, drafts) => commit(drafts),
  });

  /**
   * One core rule's row, typed by its id.
   *
   * @param id The rule.
   * @returns The row.
   */
  function row<Id extends CoreRuleId>(id: Id) {
    return (
      <RuleRow
        dirty={fields.isDirty(id)}
        draft={fields.values[id]}
        editable={fields.editable}
        error={fields.error(id)}
        id={id}
        key={id}
        mayEdit={access.mayEdit}
        onChange={(draft) => {
          fields.set(id, draft);
        }}
        previewPaths={actions.paths}
        saved={working[id]}
        switchId={fields.id(id)}
      />
    );
  }

  const custom = customRules(working);

  return (
    <Card aria-labelledby={titleId} as="section">
      <CardHead
        beside={<SectionMarks />}
        title={section.title}
        titleId={titleId}
        trailing={<PolicyVersionTag loadHistory={actions.history} version={policy.version} />}
      />

      <div className="policy-card__toast-seat" role="status">
        {toast !== null && (
          <div className="policy-card__toast">
            <span className="policy-card__toast-text">{toast.text}</span>
            <span className="policy-card__toast-line">{toast.line}</span>
            <span className="policy-card__toast-actions">
              <Link className="policy-card__toast-link" href={toast.href}>
                {toast.link} <span aria-hidden="true">→</span>
              </Link>
              <Button
                aria-label={DISMISS_TOAST}
                onClick={() => {
                  setToast(null);
                }}
                size="sm"
                tone="ghost"
              >
                <span aria-hidden="true">×</span>
              </Button>
            </span>
          </div>
        )}
      </div>

      {policy.version === null && (
        <p className="policy-card__note" role="note">
          {UNPUBLISHED_NOTE}
        </p>
      )}

      <div className="policy-card__rules">
        {CORE_RULES.map((id) => row(id))}
        {custom.map(([id, rule]) => (
          <CustomRule id={id} key={id} rule={rule} />
        ))}
      </div>

      {fields.refusal !== null && (
        <p className="policy-card__refusal" role="note">
          {fields.refusal}
        </p>
      )}

      <div className="policy-card__override">
        <p className="policy-card__note">{OVERRIDE_LEAD}</p>
        {dryRun.ok ? (
          <DryRunRow mayAdminister={access.mayEdit} policy={dryRun.value} />
        ) : (
          <p className="policy-card__note" role="note">
            {dryRunUnread(dryRun.reason)}
          </p>
        )}
      </div>

      <div className="policy-card__foot">
        <p className="policy-card__versioned">{FOOTER_LINE}</p>
        <p className="policy-card__code">
          <span className="policy-card__code-name">
            {EDIT_AS_CODE} <span aria-hidden="true">→</span>
          </span>
          <Tag>{SOON}</Tag>
          <span className="policy-card__code-note">{EDIT_AS_CODE_SOON}</span>
        </p>
      </div>

      <PublishDialog
        onDecide={(decision) => {
          pending.current?.(decision);
        }}
        owners={owners}
        preview={confirming?.preview ?? null}
      />
    </Card>
  );
}

/** The card's four calls — what a test replaces. */
export interface PolicyCardActions {
  /** What publishing a draft would do. */
  readonly preview: (document: PolicyDocument) => Promise<PreviewResult>;
  /** Publish the next version. */
  readonly publish: (
    document: PolicyDocument,
    baseVersion: number | null,
    changeNote: string | null,
  ) => Promise<PublishResult>;
  /** A page of the history. */
  readonly history: (before?: number) => Promise<HistoryResult>;
  /** What a list of globs matches. */
  readonly paths: (globs: readonly string[]) => Promise<GlobPreview>;
}

/** The Server Actions, as the card's calls. */
const SERVER_ACTIONS: PolicyCardActions = {
  preview: previewPolicy,
  publish: publishPolicy,
  history: loadPolicyHistory,
  paths: previewPolicyPaths,
};

/** A confirmation in front of the reader. */
interface Confirming {
  /** What publishing would do. */
  readonly preview: PolicyPreview;
}

/**
 * The `custom:*` rules a document carries, in its order.
 *
 * @param document The working document.
 * @returns Each custom rule with its id.
 */
function customRules(document: PolicyDocument): readonly (readonly [string, PolicyRule])[] {
  return Object.entries(document).filter(([id]) => id.startsWith("custom:"));
}

/**
 * A `custom:*` rule, read-only: its id, whether it is on, and its terms.
 *
 * @param props.id The rule's id.
 * @param props.rule The rule.
 * @returns The row.
 */
function CustomRule({ id, rule }: Readonly<{ id: string; rule: PolicyRule }>) {
  return (
    <div className="policy-card__custom">
      <p className="policy-card__custom-head">
        <span className="policy-card__custom-name">{id}</span>
        <Tag className={cx(!rule.enabled && "policy-card__custom-off")}>
          {SIDE_STATES[rule.enabled ? "on" : "off"]}
        </Tag>
      </p>
      <p className="policy-card__terms">
        {ruleChips(id, rule).map((chip) => (
          <Tag key={chip}>{chip}</Tag>
        ))}
      </p>
      <p className="policy-card__note">{CUSTOM_RULE_NOTE}</p>
    </div>
  );
}
