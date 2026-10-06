"use client";

import { useId } from "react";

import type { Enablement } from "@/app/api/enablement";
import type { Reading } from "@/app/api/reading";
import type { TicketSource } from "@/app/api/sources";
import { EnablementSwitch } from "@/app/login/enablement-switch";
import { Card, CardHead, Chip, Tag } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import { setRepositoryEnabled } from "./actions";
import {
  type Abilities,
  ENABLE_ADMIN_REASON,
  PICKER_CURRENT,
  PICKER_EMPTY,
  PICKER_LINE,
  PICKER_LIST_LABEL,
  PICKER_LOADING,
  PICKER_NO_SOURCE,
  PICKER_PILL_ACTIVE,
  PICKER_PILL_DONE,
  PICKER_TITLE,
  REPO_PARAM,
  githubSources,
  pickerRowNote,
  pickerRows,
  switchLabel,
} from "./view";

import "./get-started.css";

/** What {@link RepoPicker} takes. */
export interface RepoPickerProps {
  /** The repository this wizard is for, or null when the workspace has mirrored none. */
  readonly repo: string | null;
  /** The workspace's ticket sources, or why they could not be read — or null while loading. */
  readonly sources: Reading<readonly TicketSource[]> | null;
  /** The workspace's GitHub mirror, or why it could not be read — or null while loading. */
  readonly enablement: Reading<Enablement> | null;
  /** Whether the rail says step 2 is done. */
  readonly stepDone: boolean;
  /** What the person may do: owners and admins switch a repository on. */
  readonly abilities: Abilities;
}

/**
 * Step 2's embedded flow (BC.6, [#395](https://github.com/NobuData/ouroboros/issues/395)) —
 * *Pick a repo* inside the wizard's frame.
 *
 * **The existing enablement surface.** Each row is the login screen's `EnablementSwitch`
 * (`app/login/enablement-switch.tsx`): a `<button role="switch">` in a one-field form that
 * submits the state to move *to*, working before hydration and without JavaScript. Behind it is
 * the tenancy API's own upsert — a repository nobody has recorded comes to be known by being
 * switched on — so the wizard grows no enablement machinery of its own.
 *
 * **The rows are the repositories the GitHub sources name.** Not the mirror's: in a workspace
 * that has just connected GitHub the mirror is empty, and what a person is choosing between is
 * what the source they connected can read. The mirror says, per row, whether it is recorded
 * and on; a row not recorded says so, and that switching it on records it.
 *
 * A viewer sees every switch read-only with the reason, as the login screen shows them.
 *
 * @param props See {@link RepoPickerProps}.
 * @returns The card.
 */
export function RepoPicker({ repo, sources, enablement, stepDone, abilities }: RepoPickerProps) {
  const titleId = useId();
  const reasonId = useId();
  const connected = sources?.ok === true ? githubSources(sources.value) : [];
  const rows = sources?.ok === true ? pickerRows(sources.value, enablement?.ok === true ? enablement.value : null, repo) : [];

  return (
    <Card aria-labelledby={titleId} as="section" className="wizard-picker">
      <CardHead
        beside={
          stepDone ? (
            <Chip tone="ok">{PICKER_PILL_DONE}</Chip>
          ) : (
            <Chip dot="pulse" tone="accent">
              {PICKER_PILL_ACTIVE}
            </Chip>
          )
        }
        title={PICKER_TITLE}
        titleId={titleId}
      />
      <p className="wizard-picker__line">{PICKER_LINE}</p>

      {sources === null || enablement === null ? (
        <p aria-busy className="wizard-picker__state" role="status">
          {PICKER_LOADING}
        </p>
      ) : !sources.ok ? (
        <p className="wizard-picker__failure" role="alert">
          {sources.reason}
        </p>
      ) : connected.length === 0 ? (
        <p className="wizard-picker__state">{PICKER_NO_SOURCE}</p>
      ) : rows.length === 0 ? (
        <p className="wizard-picker__state">{PICKER_EMPTY}</p>
      ) : (
        <>
          {!enablement.ok && (
            <p className="wizard-picker__failure" role="alert">
              {enablement.reason}
            </p>
          )}
          {!abilities.administer && (
            <p className="wizard-picker__readonly" id={reasonId} role="note">
              {ENABLE_ADMIN_REASON}
            </p>
          )}
          <ul aria-label={PICKER_LIST_LABEL} className="wizard-picker__rows">
            {rows.map((row) => (
              <li
                className={cx(
                  "wizard-picker__row",
                  row.enabled && "wizard-picker__row--on",
                  row.current && "wizard-picker__row--current",
                )}
                data-repo={row.repo}
                key={row.repo}
              >
                <span className="wizard-picker__text">
                  <span className="wizard-picker__repo">
                    <span className="wizard-picker__login">{row.login} /</span> {row.name}
                    {row.current && <Tag>{PICKER_CURRENT}</Tag>}
                  </span>
                  <span className="wizard-picker__note">{pickerRowNote(row)}</span>
                </span>
                <span className="wizard-picker__switch">
                  <EnablementSwitch
                    action={setRepositoryEnabled}
                    describedBy={abilities.administer ? undefined : reasonId}
                    enabled={row.enabled}
                    fields={{ [REPO_PARAM]: row.repo }}
                    label={switchLabel(row)}
                    reason={abilities.administer ? undefined : ENABLE_ADMIN_REASON}
                  />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
