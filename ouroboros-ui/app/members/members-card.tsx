"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import type {
  MemberChange,
  MemberInvitation,
  MembersPage,
  OrganizationRole,
  ServiceAccount,
  ServiceAccountList,
  ServiceAccountSecret,
  ServiceScopeName,
  WorkspaceMember,
} from "@/app/api/settings-members";
import { SectionMarks } from "@/app/settings/settings-seat";
import { sectionTitleId } from "@/app/settings/view";
import { Button, Card, CardHead, type Column, Table, Tag } from "@/app/ui";

import { InviteDialog } from "./invite-dialog";
import { MemberDialog } from "./member-dialog";
import {
  createServiceAccount,
  inviteMember,
  removeMember,
  resendInvitation,
  revokeInvitation,
  revokeServiceAccount,
  rotateServiceAccount,
  updateMember,
} from "./members-actions";
import { ServiceAccounts } from "./service-accounts";
import { type ShownToken, TokenOnce } from "./token-once";
import {
  CAPABILITY_CONSEQUENCE,
  CAPABILITY_NO,
  CAPABILITY_YES,
  type CardRow,
  INVITE_LABEL,
  MEMBERS_CAPTION,
  MEMBERS_TITLE,
  MEMBER_COLUMNS,
  type MembersWrite,
  NEVER,
  RESEND,
  REVOKE,
  SERVICE_GLYPH,
  SERVICE_NO_CAPABILITY,
  WORKING,
  type ServiceRowModel,
  YOU_TAG,
  capabilityChanged,
  capabilityLabel,
  capabilityRefused,
  cardRows,
  directorySyncLine,
  initials,
  invitationActionLabel,
  invitationDone,
  invitedAgo,
  invited,
  manageLabel,
  memberChanged,
  relativeAge,
  revoked,
  serviceRows,
} from "./view";

import "./members.css";

/** Every write the card makes — the Server Actions by default, fakes in a suite. */
export interface MembersActions {
  readonly invite: (
    email: string,
    role: OrganizationRole,
  ) => Promise<MembersWrite<MemberInvitation>>;
  readonly resend: (id: string) => Promise<MembersWrite<MemberInvitation>>;
  readonly revokeInvitation: (id: string) => Promise<MembersWrite<null>>;
  readonly update: (
    memberId: string,
    change: MemberChange,
  ) => Promise<MembersWrite<WorkspaceMember>>;
  readonly remove: (memberId: string) => Promise<MembersWrite<null>>;
  readonly createServiceAccount: (
    name: string,
    scopes: readonly ServiceScopeName[],
  ) => Promise<MembersWrite<ServiceAccountSecret>>;
  readonly rotateServiceAccount: (id: string) => Promise<MembersWrite<ServiceAccountSecret>>;
  readonly revokeServiceAccount: (id: string) => Promise<MembersWrite<ServiceAccount>>;
}

/** The Server Actions. */
export const SERVER_MEMBERS_ACTIONS: MembersActions = {
  invite: inviteMember,
  resend: resendInvitation,
  revokeInvitation,
  update: updateMember,
  remove: removeMember,
  createServiceAccount,
  rotateServiceAccount,
  revokeServiceAccount,
};

/** What {@link MembersCard} takes. */
export interface MembersCardProps {
  /** The members page as read. */
  readonly page: MembersPage;
  /** The administrator's service-account list (hints, the scope registry), or `null`. */
  readonly serviceAccounts: ServiceAccountList | null;
  /** When the page was read — what relative ages are measured against until the first write. */
  readonly readAt: string;
  /** Whether the reader may make someone an owner. */
  readonly mayOwn: boolean;
  /** The writes. */
  readonly actions?: MembersActions;
}

/** The card's one toast. */
interface Toast {
  readonly message: string;
  readonly tone: "ok" | "error";
}

/**
 * The **Members & Roles** card — mockup 17's `c-7` (BS.3,
 * [#493](https://github.com/NobuData/ouroboros/issues/493)), over `GET /api/v1/settings/members`.
 *
 * One table, three kinds of row (`app/members/view.ts` says why each carries what it carries):
 * people with their role, **Can approve loops** and a real *last active*; service accounts as
 * `Service` rows that never hold the capability; and dimmed pending invitations with their age,
 * **Resend** and **Revoke**. Under it, the service-account section, and the footer: the role
 * hierarchy the API enforces, and a directory-sync line **only** when the service reports a real
 * sync (none until BT.1).
 *
 * ### Writes act at once
 *
 * The section is immediate in the save model: nothing here joins **Save changes**.
 * - **The capability box is optimistic.** It moves when pressed, the write goes, and a refusal
 *   puts it back with an error toast; its consequence is its accessible description and its
 *   tooltip, so it is stated before it is used.
 * - Invitations, role changes, removals and service-account changes each confirm or open a
 *   dialog, and a refusal stays in that dialog with the service's sentence.
 * - A change to the reader's **own** role refreshes the page, because what they may do here moved.
 *
 * ### A reader who may not manage
 *
 * Gets the same table, legible: marks instead of boxes, roles as text, no Invite, no Resend, no
 * service-account controls — and never a token hint, which only an administrator's read carries.
 *
 * @param props See {@link MembersCardProps}.
 * @returns The card.
 */
export function MembersCard({
  page,
  serviceAccounts,
  readAt,
  mayOwn,
  actions = SERVER_MEMBERS_ACTIONS,
}: MembersCardProps) {
  const router = useRouter();
  const canManage = page.canManage;
  const titleId = sectionTitleId("members");

  const [members, setMembers] = useState<readonly WorkspaceMember[]>(page.members);
  const [invitations, setInvitations] = useState<readonly MemberInvitation[]>(page.invitations);
  const [services, setServices] = useState<readonly ServiceRowModel[]>(() =>
    serviceRows(serviceAccounts?.items ?? null, page.serviceAccounts),
  );
  const [now, setNow] = useState(() => Date.parse(readAt));
  const [capability, setCapability] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [toast, setToast] = useState<Toast | null>(null);
  const [inviting, setInviting] = useState(false);
  const [managing, setManaging] = useState<WorkspaceMember | null>(null);
  const [shown, setShown] = useState<ShownToken | null>(null);
  const [busyInvitations, setBusyInvitations] = useState<ReadonlySet<string>>(new Set());

  /**
   * Say one thing in the toast, and move the clock to now — a write just happened.
   *
   * @param message The sentence.
   * @param tone Whether it went well.
   */
  function say(message: string, tone: Toast["tone"] = "ok"): void {
    setNow(Date.now());
    setToast({ message, tone });
  }

  async function toggleCapability(member: WorkspaceMember, next: boolean): Promise<void> {
    if (capability.has(member.id)) return;

    setCapability((current) => new Map(current).set(member.id, next));

    const result = await actions.update(member.id, { canApproveLoops: next });

    setCapability((current) => {
      const copy = new Map(current);
      copy.delete(member.id);
      return copy;
    });

    if (result.ok) {
      setMembers((current) => current.map((each) => (each.id === member.id ? result.value : each)));
      say(capabilityChanged(member.name, result.value.canApproveLoops));
    } else {
      say(capabilityRefused(member.name, result.reason), "error");
    }
  }

  async function invitationAction(
    invitation: MemberInvitation,
    action: "resend" | "revoke",
  ): Promise<void> {
    if (busyInvitations.has(invitation.id)) return;

    setBusyInvitations((current) => new Set(current).add(invitation.id));

    try {
      if (action === "resend") {
        const result = await actions.resend(invitation.id);
        if (!result.ok) return say(result.reason, "error");

        setInvitations((current) =>
          current.map((each) => (each.id === invitation.id ? result.value : each)),
        );
      } else {
        const result = await actions.revokeInvitation(invitation.id);
        if (!result.ok) return say(result.reason, "error");

        setInvitations((current) => current.filter((each) => each.id !== invitation.id));
      }

      say(invitationDone(action, invitation.email));
    } finally {
      setBusyInvitations((current) => {
        const copy = new Set(current);
        copy.delete(invitation.id);
        return copy;
      });
    }
  }

  const rows = cardRows(members, services, invitations);
  const sync = directorySyncLine(page.footer.directorySync, now);

  const columns: readonly Column<CardRow>[] = [
    {
      key: "member",
      header: MEMBER_COLUMNS.member,
      cell: (row) => <WhoCell row={row} />,
    },
    {
      key: "role",
      header: MEMBER_COLUMNS.role,
      cell: (row) => {
        if (row.kind === "service") return "Service";
        if (row.kind === "invitation") return row.invitation.displayRole;
        if (!canManage) return row.member.displayRole;

        return (
          <button
            aria-haspopup="dialog"
            aria-label={manageLabel(row.member.name, row.member.displayRole)}
            className="members__role"
            onClick={() => setManaging(row.member)}
            type="button"
          >
            {row.member.displayRole}
          </button>
        );
      },
    },
    {
      key: "capability",
      header: MEMBER_COLUMNS.capability,
      cell: (row) => {
        if (row.kind === "invitation") {
          return <span className="members__muted">{invitedAgo(row.invitation, now)}</span>;
        }
        if (row.kind === "service") {
          return (
            <span className="members__no" title={SERVICE_NO_CAPABILITY}>
              {CAPABILITY_NO}
            </span>
          );
        }

        const pending = capability.get(row.member.id);
        const checked = pending ?? row.member.canApproveLoops;

        return canManage ? (
          <CapabilityBox
            busy={pending !== undefined}
            checked={checked}
            name={row.member.name}
            onChange={(next) => void toggleCapability(row.member, next)}
          />
        ) : (
          <span className={checked ? "members__yes" : "members__no"}>
            {checked ? CAPABILITY_YES : CAPABILITY_NO}
          </span>
        );
      },
    },
    {
      key: "lastActive",
      header: MEMBER_COLUMNS.lastActive,
      mono: true,
      cell: (row) => {
        if (row.kind === "member") return relativeAge(row.member.lastActiveAt, now);
        if (row.kind === "service") return relativeAge(row.account.lastUsedAt, now);
        if (!canManage) return NEVER;

        const busy = busyInvitations.has(row.invitation.id);

        return (
          <span className="members__actions">
            <Button
              aria-label={invitationActionLabel(RESEND, row.invitation.email)}
              reason={busy ? WORKING : undefined}
              onClick={() => void invitationAction(row.invitation, "resend")}
              size="sm"
              tone="ghost"
            >
              {RESEND}
            </Button>
            <Button
              aria-label={invitationActionLabel(REVOKE, row.invitation.email)}
              reason={busy ? WORKING : undefined}
              onClick={() => void invitationAction(row.invitation, "revoke")}
              size="sm"
              tone="ghost"
            >
              {REVOKE}
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <Card aria-labelledby={titleId} as="section">
      <CardHead
        beside={<SectionMarks />}
        title={MEMBERS_TITLE}
        titleId={titleId}
        trailing={
          canManage ? (
            <Button aria-haspopup="dialog" onClick={() => setInviting(true)} size="sm" tone="ghost">
              {INVITE_LABEL}
            </Button>
          ) : undefined
        }
      />

      <Table
        caption={MEMBERS_CAPTION}
        captionHidden
        columns={columns}
        rowClassName={(row) => (row.kind === "invitation" ? "members__row--pending" : undefined)}
        rowKey={(row) => row.key}
        rows={rows}
      />

      <ServiceAccounts
        actions={{
          create: actions.createServiceAccount,
          rotate: actions.rotateServiceAccount,
          revoke: actions.revokeServiceAccount,
        }}
        mayManage={canManage}
        now={now}
        onRevoked={(id, name) => {
          setServices((current) => current.filter((each) => each.id !== id));
          say(revoked(name));
        }}
        onSecret={(secret, rotated) => {
          const row: ServiceRowModel = {
            id: secret.account.id,
            name: secret.account.name,
            scopes: secret.account.scopes,
            lastUsedAt: secret.account.token?.lastUsedAt ?? null,
            hint: secret.account.token?.hint ?? null,
          };

          setServices((current) =>
            rotated ? current.map((each) => (each.id === row.id ? row : each)) : [...current, row],
          );
          setNow(Date.now());
          setShown({ name: secret.account.name, token: secret.token, rotated });
        }}
        rows={services}
        scopes={serviceAccounts?.scopes ?? null}
      />

      <footer className="members__footer">
        {sync !== null && <span className="members__sync">{sync}</span>}
        <span>{page.footer.hierarchy}</span>
      </footer>

      {toast !== null && (
        <p
          className={
            toast.tone === "error" ? "members__toast members__toast--error" : "members__toast"
          }
          role={toast.tone === "error" ? "alert" : "status"}
        >
          {toast.message}
        </p>
      )}

      {canManage && (
        <InviteDialog
          mayOwn={mayOwn}
          onClose={() => setInviting(false)}
          onInvite={actions.invite}
          onInvited={(invitation) => {
            setInviting(false);
            setInvitations((current) => [invitation, ...current]);
            say(invited(invitation.email));
          }}
          open={inviting}
        />
      )}

      {canManage && managing !== null && (
        <MemberDialog
          key={managing.id}
          mayOwn={mayOwn}
          member={managing}
          members={members}
          onChanged={(member, role) => {
            setManaging(null);
            setMembers((current) => current.map((each) => (each.id === member.id ? member : each)));
            say(memberChanged(member.name, role));
            if (member.you) router.refresh();
          }}
          onClose={() => setManaging(null)}
          onRemove={actions.remove}
          onRemoved={(member) => {
            setManaging(null);
            setMembers((current) => current.filter((each) => each.id !== member.id));
            say(memberChanged(member.name, null));
            if (member.you) router.refresh();
          }}
          onUpdate={actions.update}
        />
      )}

      {/* The one showing of a token. Closing it drops the value from this card's state. */}
      <TokenOnce onDone={() => setShown(null)} shown={shown} />
    </Card>
  );
}

/**
 * The *Member* cell: the mini-avatar (the service variant for a bot or an invitation, as the
 * mockup draws it), the name — mono for a bot and an address — and `you` on the reader's row.
 *
 * @param props.row The row.
 * @returns The cell.
 */
function WhoCell({ row }: Readonly<{ row: CardRow }>) {
  if (row.kind === "service") {
    return (
      <span className="members__who">
        <span aria-hidden className="members__avatar members__avatar--service">
          {SERVICE_GLYPH}
        </span>
        <span className="members__name members__mono">{row.account.name}</span>
      </span>
    );
  }

  if (row.kind === "invitation") {
    return (
      <span className="members__who">
        <span aria-hidden className="members__avatar members__avatar--service">
          {initials(row.invitation.email)}
        </span>
        <span className="members__name members__mono">{row.invitation.email}</span>
      </span>
    );
  }

  return (
    <span className="members__who">
      <span aria-hidden className="members__avatar">
        {initials(row.member.name)}
      </span>
      <span className="members__name">{row.member.name}</span>
      {row.member.you && <Tag>{YOU_TAG}</Tag>}
    </span>
  );
}

/**
 * **Can approve loops**, for a reader who may change it: a checkbox whose consequence is its
 * accessible description and its tooltip — stated before it is used, because a box in a table
 * row does not look like the permission change it is.
 *
 * @param props.name The member's name, for the box's accessible name.
 * @param props.checked Where it stands (optimistically, while a write is in flight).
 * @param props.busy Whether a write is in flight — the box holds still until it settles.
 * @param props.onChange Called with the new value.
 * @returns The cell.
 */
function CapabilityBox({
  name,
  checked,
  busy,
  onChange,
}: Readonly<{ name: string; checked: boolean; busy: boolean; onChange: (next: boolean) => void }>) {
  const tipId = useId();

  return (
    <span className="members__cap">
      <input
        aria-busy={busy || undefined}
        aria-describedby={tipId}
        aria-label={capabilityLabel(name)}
        checked={checked}
        className="members__box"
        onChange={(event) => {
          if (!busy) onChange(event.target.checked);
        }}
        type="checkbox"
      />
      <span aria-hidden className={checked ? "members__yes" : "members__no"}>
        {checked ? CAPABILITY_YES : CAPABILITY_NO}
      </span>
      <span className="members__tip" id={tipId} role="tooltip">
        {CAPABILITY_CONSEQUENCE}
      </span>
    </span>
  );
}
