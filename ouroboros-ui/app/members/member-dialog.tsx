"use client";

import { useId, useRef, useState } from "react";

import type { MemberChange, OrganizationRole, WorkspaceMember } from "@/app/api/settings-members";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import { RoleChoices } from "./role-choices";
import {
  CANCEL,
  LAST_OWNER_DEMOTE,
  LAST_OWNER_REMOVE,
  MANAGE_TITLE,
  type MembersWrite,
  REMOVE_CONFIRM,
  REMOVE_LABEL,
  REMOVING,
  ROLE_SAVE,
  ROLE_UNCHANGED,
  ROLE_SAVING,
  choiceOf,
  demotionWarning,
  isLastOwner,
  removeWarning,
  strongestRole,
} from "./view";

import "./members.css";

/** What {@link MemberDialog} takes. */
export interface MemberDialogProps {
  /** The member being managed. The caller keys the dialog by member, so each opens fresh. */
  readonly member: WorkspaceMember;
  /** Everyone, for the last-owner rule. */
  readonly members: readonly WorkspaceMember[];
  /** Whether the reader may make someone an owner. */
  readonly mayOwn: boolean;
  /** Change the role. */
  readonly onUpdate: (
    memberId: string,
    change: MemberChange,
  ) => Promise<MembersWrite<WorkspaceMember>>;
  /** Remove the member. */
  readonly onRemove: (memberId: string) => Promise<MembersWrite<null>>;
  /** Called with the member as they now stand. */
  readonly onChanged: (member: WorkspaceMember, role: OrganizationRole) => void;
  /** Called once the member is gone. */
  readonly onRemoved: (member: WorkspaceMember) => void;
  /** Close without changing anything. */
  readonly onClose: () => void;
}

/** Which step the dialog is on. */
type Step = "choose" | "confirm-role" | "confirm-remove";

/**
 * **Change role or remove** — the role cell's dialog for an owner or admin
 * (BS.3, [#493](https://github.com/NobuData/ouroboros/issues/493)).
 *
 * - A change that **takes power away** (Owner → Maintainer, Maintainer → Viewer) asks once more,
 *   naming what is lost; one that only adds power goes straight through.
 * - **Removal always confirms.**
 * - **The last owner's options explain themselves**: the role choices are shown unavailable with
 *   the service's own sentence, and the remove button is replaced by why it cannot be used —
 *   never silently hidden. The service enforces the rule regardless (`409 owner_protected`), and
 *   its refusal is shown here if the table was stale.
 *
 * @param props See {@link MemberDialogProps}.
 * @returns The dialog.
 */
export function MemberDialog({
  member,
  members,
  mayOwn,
  onUpdate,
  onRemove,
  onChanged,
  onRemoved,
  onClose,
}: MemberDialogProps) {
  const describedId = useId();
  const current = choiceOf(member.displayRole);
  const [role, setRole] = useState<OrganizationRole>(current);
  const [step, setStep] = useState<Step>("choose");
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const sent = useRef(false);

  const lastOwner = isLastOwner(member, members);
  const warning = demotionWarning(member.name, strongestRole(member.roles), role);
  const changed = role !== current;

  /**
   * Run one write behind the latch, keeping a refusal in the dialog.
   *
   * @param write The write.
   * @returns Whether it landed.
   */
  async function run<T>(write: () => Promise<MembersWrite<T>>): Promise<MembersWrite<T> | null> {
    if (sent.current) return null;

    sent.current = true;
    setSending(true);
    setRefusal(null);

    try {
      const result = await write();
      if (!result.ok) setRefusal(result.reason);
      return result;
    } finally {
      sent.current = false;
      setSending(false);
    }
  }

  async function saveRole(): Promise<void> {
    if (warning !== null && step !== "confirm-role") {
      setStep("confirm-role");
      return;
    }

    const result = await run(() => onUpdate(member.id, { role }));
    if (result?.ok === true) onChanged(result.value, role);
  }

  async function remove(): Promise<void> {
    if (step !== "confirm-remove") {
      setStep("confirm-remove");
      return;
    }

    const result = await run(() => onRemove(member.id));
    if (result?.ok === true) onRemoved(member);
  }

  return (
    <ShellOverlay
      describedBy={describedId}
      label={`${MANAGE_TITLE}: ${member.name}`}
      onClose={onClose}
      open
    >
      <div className="members-dialog">
        <h2 className="members-dialog__title">{member.name}</h2>
        <p className="members-dialog__note" id={describedId}>
          {member.email}
        </p>

        <RoleChoices
          lockedReason={lastOwner ? LAST_OWNER_DEMOTE : undefined}
          mayOwn={mayOwn}
          name={`role-${member.id}`}
          onChange={(next) => {
            setRole(next);
            setStep("choose");
          }}
          value={role}
        />

        {step === "confirm-role" && warning !== null && (
          <p className="members-dialog__warning" role="alert">
            {warning}
          </p>
        )}

        {refusal !== null && (
          <p className="members-dialog__refusal" role="alert">
            {refusal}
          </p>
        )}

        <div className="members-dialog__actions">
          <Button onClick={onClose} type="button">
            {CANCEL}
          </Button>
          {!lastOwner && (
            <Button
              reason={!changed ? ROLE_UNCHANGED : sending ? ROLE_SAVING : undefined}
              onClick={() => void saveRole()}
              tone={step === "confirm-role" ? "danger" : "primary"}
            >
              {sending && step !== "confirm-remove" ? ROLE_SAVING : ROLE_SAVE}
            </Button>
          )}
        </div>

        <div className="members-dialog__danger">
          {lastOwner ? (
            <p className="members-dialog__note" role="note">
              {LAST_OWNER_REMOVE}
            </p>
          ) : (
            <>
              {step === "confirm-remove" && (
                <p className="members-dialog__warning" role="alert">
                  {removeWarning(member.name)}
                </p>
              )}
              <div className="members-dialog__actions">
                <Button
                  onClick={() => void remove()}
                  reason={sending ? REMOVING : undefined}
                  tone="danger"
                >
                  {step === "confirm-remove" ? (sending ? REMOVING : REMOVE_CONFIRM) : REMOVE_LABEL}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </ShellOverlay>
  );
}
