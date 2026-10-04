/**
 * Mockup 17's Members & Roles card as data (BS.3, #493): Ken (the reader, Owner), Maya
 * (Maintainer, may approve), Jorge (Viewer), the `devops-bot` service account and Priya's pending
 * invitation — every row class the card draws, read at {@link MEMBERS_READ_AT}.
 */

import type {
  MemberInvitation,
  MembersPage,
  ServiceAccount,
  ServiceAccountList,
  ServiceAccountSecret,
  WorkspaceMember,
} from "@/app/api/settings-members";
import type { MembersActions } from "@/app/members/members-card";
import type { MembersWrite } from "@/app/members/view";
import { vi } from "vitest";

/** When the page was read. Every relative age is measured from here. */
export const MEMBERS_READ_AT = "2026-10-04T12:00:00.000Z";

/**
 * An instant before {@link MEMBERS_READ_AT}.
 *
 * @param seconds How long before.
 * @returns The ISO string.
 */
export function ago(seconds: number): string {
  return new Date(Date.parse(MEMBERS_READ_AT) - seconds * 1000).toISOString();
}

/** Ken — the reader, and the only owner. */
export const KEN: WorkspaceMember = {
  id: "mem-ken",
  userId: "user-ken",
  name: "Ken S",
  email: "ken@acme-robotics.dev",
  image: null,
  roles: ["owner"],
  displayRole: "Owner",
  you: true,
  canApproveLoops: true,
  canApproveLoopsSource: "role",
  lastActiveAt: ago(2),
  joinedAt: ago(86_400 * 90),
};

/** Maya — a Maintainer who may approve. */
export const MAYA: WorkspaceMember = {
  id: "mem-maya",
  userId: "user-maya",
  name: "Maya Chen",
  email: "maya@acme-robotics.dev",
  image: null,
  roles: ["admin"],
  displayRole: "Maintainer",
  you: false,
  canApproveLoops: true,
  canApproveLoopsSource: "role",
  lastActiveAt: ago(12 * 60),
  joinedAt: ago(86_400 * 60),
};

/** Jorge — a Viewer, never active as far as the service knows. */
export const JORGE: WorkspaceMember = {
  id: "mem-jorge",
  userId: "user-jorge",
  name: "Jorge Reyes",
  email: "jorge@acme-robotics.dev",
  image: null,
  roles: ["member"],
  displayRole: "Viewer",
  you: false,
  canApproveLoops: false,
  canApproveLoopsSource: "role",
  lastActiveAt: ago(3 * 86_400),
  joinedAt: ago(86_400 * 30),
};

/** Priya's pending invitation, two hours old. */
export const PRIYA: MemberInvitation = {
  id: "inv-priya",
  email: "priya@acme.dev",
  roles: ["admin"],
  displayRole: "Maintainer",
  invitedAt: ago(2 * 3600),
  expiresAt: ago(-5 * 86_400),
  expired: false,
};

/** The bot, as the administrator's list carries it. */
export const DEVOPS_BOT: ServiceAccount = {
  id: "5eed0091-0000-4000-8000-000000000001",
  name: "devops-bot",
  actor: "service:devops-bot",
  scopes: ["farm.submit", "api.read"],
  createdAt: ago(86_400 * 3),
  createdBy: "user-ken",
  disabledAt: null,
  token: { hint: "orb_svc_••••ab12", createdAt: ago(86_400 * 3), lastUsedAt: ago(41) },
};

/** The hierarchy line the service renders. */
export const HIERARCHY = "Owner > Maintainer (approve/merge) > Viewer (read-only)";

/**
 * The members page as an owner reads it.
 *
 * @param over What to change.
 * @returns The page.
 */
export function membersPage(over: Partial<MembersPage> = {}): MembersPage {
  return {
    members: [KEN, MAYA, JORGE],
    invitations: [PRIYA],
    serviceAccounts: [
      {
        id: DEVOPS_BOT.id,
        name: DEVOPS_BOT.name,
        actor: DEVOPS_BOT.actor,
        displayRole: "Service",
        scopes: DEVOPS_BOT.scopes,
        canApproveLoops: false,
        lastActiveAt: ago(41),
      },
    ],
    canManage: true,
    footer: { hierarchy: HIERARCHY, directorySync: null },
    ...over,
  };
}

/** The administrator's service-account list. */
export const SERVICE_LIST: ServiceAccountList = {
  items: [DEVOPS_BOT],
  scopes: [
    { scope: "api.read", description: "Read any workspace resource a viewer may read (GET requests)." },
    { scope: "farm.submit", description: "Submit and cancel build-farm jobs (POST /farm/jobs)." },
  ],
};

/** A token as a create or rotate answers it. */
export const MINTED_TOKEN = `orb_svc_${"A".repeat(43)}`;

/**
 * A create or rotate answer.
 *
 * @param name The account.
 * @returns The account and its token.
 */
export function secretFor(name: string): ServiceAccountSecret {
  return {
    account: { ...DEVOPS_BOT, id: `sa-${name}`, name, token: { ...DEVOPS_BOT.token!, lastUsedAt: null } },
    token: MINTED_TOKEN,
  };
}

/**
 * A success.
 *
 * @param value What it returned.
 * @returns The outcome.
 */
export function landed<T>(value: T): MembersWrite<T> {
  return { ok: true, value };
}

/**
 * A refusal.
 *
 * @param reason The service's sentence.
 * @param code Its code.
 * @returns The outcome.
 */
export function refused<T>(reason: string, code = "forbidden"): MembersWrite<T> {
  return { ok: false, reason, code };
}

/**
 * Fake writes that succeed with sensible answers unless a case says otherwise.
 *
 * @returns The actions, each a `vi.fn`.
 */
export function fakeActions() {
  return {
    invite: vi.fn((email: string, role: "owner" | "admin" | "member" | "viewer") =>
      Promise.resolve(
        landed<MemberInvitation>({
          id: `inv-${email}`,
          email,
          roles: [role],
          displayRole: role === "owner" ? "Owner" : role === "admin" ? "Maintainer" : "Viewer",
          invitedAt: MEMBERS_READ_AT,
          expiresAt: ago(-7 * 86_400),
          expired: false,
        }),
      ),
    ),
    // An invitation the fake invited is `inv-<email>`, so its address survives a resend.
    resend: vi.fn((id: string) =>
      Promise.resolve(
        landed<MemberInvitation>({
          ...PRIYA,
          id,
          email: id === PRIYA.id ? PRIYA.email : id.replace(/^inv-/, ""),
        }),
      ),
    ),
    revokeInvitation: vi.fn(() => Promise.resolve(landed(null))),
    update: vi.fn((memberId: string, change: { role?: string; canApproveLoops?: boolean }) => {
      const member = [KEN, MAYA, JORGE].find((each) => each.id === memberId) ?? MAYA;
      return Promise.resolve(
        landed<WorkspaceMember>({
          ...member,
          ...(change.canApproveLoops !== undefined
            ? { canApproveLoops: change.canApproveLoops, canApproveLoopsSource: "explicit" }
            : {}),
          ...(change.role !== undefined
            ? {
                roles: [change.role as WorkspaceMember["roles"][number]],
                displayRole:
                  change.role === "owner"
                    ? "Owner"
                    : change.role === "admin"
                      ? "Maintainer"
                      : "Viewer",
              }
            : {}),
        }),
      );
    }),
    remove: vi.fn(() => Promise.resolve(landed(null))),
    createServiceAccount: vi.fn((name: string) => Promise.resolve(landed(secretFor(name)))),
    rotateServiceAccount: vi.fn(() => Promise.resolve(landed(secretFor("devops-bot")))),
    revokeServiceAccount: vi.fn(() =>
      Promise.resolve(landed<ServiceAccount>({ ...DEVOPS_BOT, disabledAt: MEMBERS_READ_AT, token: null })),
    ),
  } satisfies MembersActions;
}
