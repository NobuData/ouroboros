"use client";

import { type FormEvent, useId, useRef, useState } from "react";

import type { MemberInvitation, OrganizationRole } from "@/app/api/settings-members";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, TextField } from "@/app/ui";

import { RoleChoices } from "./role-choices";
import {
  CANCEL,
  DEFAULT_INVITE_ROLE,
  INVITE_EMAIL,
  INVITE_NOTE,
  INVITE_SEND,
  INVITE_SENDING,
  INVITE_TITLE,
  type MembersWrite,
} from "./view";

import "./members.css";

/** What {@link InviteDialog} takes. */
export interface InviteDialogProps {
  /** Whether it is showing. */
  readonly open: boolean;
  /** Whether the reader may make someone an owner — owners only. */
  readonly mayOwn: boolean;
  /** Send the invitation. */
  readonly onInvite: (
    email: string,
    role: OrganizationRole,
  ) => Promise<MembersWrite<MemberInvitation>>;
  /** Called with the new invitation once it exists. */
  readonly onInvited: (invitation: MemberInvitation) => void;
  /** Close without inviting. */
  readonly onClose: () => void;
}

/**
 * **+ Invite member** — an address and a role, composing the organization plugin's invitation
 * through `POST /api/v1/settings/members/invitations`
 * (BS.3, [#493](https://github.com/NobuData/ouroboros/issues/493)).
 *
 * A refusal stays in the dialog with the service's sentence, beside the address the reader typed,
 * rather than closing it and leaving them to type it again.
 *
 * @param props See {@link InviteDialogProps}.
 * @returns The dialog.
 */
export function InviteDialog({ open, mayOwn, onInvite, onInvited, onClose }: InviteDialogProps) {
  const emailId = useId();
  const noteId = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationRole>(DEFAULT_INVITE_ROLE);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // A latch beside the state: two presses inside one frame both read `sending` as false.
  const sent = useRef(false);

  function close(): void {
    setEmail("");
    setRole(DEFAULT_INVITE_ROLE);
    setRefusal(null);
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (sent.current) return;

    sent.current = true;
    setSending(true);
    setRefusal(null);

    try {
      const result = await onInvite(email.trim(), role);

      if (result.ok) {
        setEmail("");
        setRole(DEFAULT_INVITE_ROLE);
        onInvited(result.value);
      } else {
        setRefusal(result.reason);
      }
    } finally {
      sent.current = false;
      setSending(false);
    }
  }

  return (
    <ShellOverlay describedBy={noteId} label={INVITE_TITLE} onClose={close} open={open}>
      <form className="members-dialog" onSubmit={(event) => void submit(event)}>
        <h2 className="members-dialog__title">{INVITE_TITLE}</h2>
        <TextField
          autoComplete="off"
          id={emailId}
          label={INVITE_EMAIL}
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
        <RoleChoices mayOwn={mayOwn} name="invite-role" onChange={setRole} value={role} />
        <p className="members-dialog__note" id={noteId}>
          {INVITE_NOTE}
        </p>
        {refusal !== null && (
          <p className="members-dialog__refusal" role="alert">
            {refusal}
          </p>
        )}
        <div className="members-dialog__actions">
          <Button onClick={close} type="button">
            {CANCEL}
          </Button>
          <Button reason={sending ? INVITE_SENDING : undefined} tone="primary" type="submit">
            {sending ? INVITE_SENDING : INVITE_SEND}
          </Button>
        </div>
      </form>
    </ShellOverlay>
  );
}
