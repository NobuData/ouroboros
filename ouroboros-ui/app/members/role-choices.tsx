"use client";

import { useId } from "react";

import type { OrganizationRole } from "@/app/api/settings-members";

import { INVITE_ROLE, OWNER_ONLY_REASON, ROLE_CHOICES } from "./view";

import "./members.css";

/** What {@link RoleChoices} takes. */
export interface RoleChoicesProps {
  /** The radio group's name — unique per dialog. */
  readonly name: string;
  /** The chosen role. */
  readonly value: OrganizationRole;
  /** Choose one. */
  readonly onChange: (role: OrganizationRole) => void;
  /** Whether the reader may make someone an owner — owners only. */
  readonly mayOwn: boolean;
  /**
   * Why no other role may be chosen at all — the last owner's protection. Present, every choice
   * but the current one is unavailable and the reason is printed, not hidden.
   */
  readonly lockedReason?: string;
}

/**
 * The three roles a person can be given — Owner, Maintainer, Viewer — as one radio group
 * (BS.3, [#493](https://github.com/NobuData/ouroboros/issues/493)).
 *
 * **An unavailable choice explains itself.** The Owner choice stays in the list for an admin,
 * with *Only an owner can make someone an owner.* beside it, and the last owner's dialog prints
 * why their role cannot change: options that silently vanished would read as a bug.
 *
 * @param props See {@link RoleChoicesProps}.
 * @returns The group.
 */
export function RoleChoices({ name, value, onChange, mayOwn, lockedReason }: RoleChoicesProps) {
  const legendId = useId();
  const lockId = useId();

  return (
    <fieldset
      aria-describedby={lockedReason === undefined ? undefined : lockId}
      aria-labelledby={legendId}
      className="members-dialog__choices"
    >
      <legend className="members-dialog__legend" id={legendId}>
        {INVITE_ROLE}
      </legend>
      {ROLE_CHOICES.map((choice) => {
        const ownerOnly = choice.role === "owner" && !mayOwn && value !== "owner";
        const locked = lockedReason !== undefined && choice.role !== value;
        const unavailable = ownerOnly || locked;

        return (
          <label className="members-dialog__choice" key={choice.role}>
            <input
              checked={value === choice.role}
              disabled={unavailable}
              name={name}
              onChange={() => onChange(choice.role)}
              type="radio"
              value={choice.role}
            />
            <span>
              {choice.label} <span className="members-dialog__why">— {choice.note}</span>
              {ownerOnly && !locked && (
                <span className="members-dialog__why"> · {OWNER_ONLY_REASON}</span>
              )}
            </span>
          </label>
        );
      })}
      {lockedReason !== undefined && (
        <p className="members-dialog__note" id={lockId} role="note">
          {lockedReason}
        </p>
      )}
    </fieldset>
  );
}
