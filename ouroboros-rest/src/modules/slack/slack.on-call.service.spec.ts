import type { Transaction } from "kysely";

import type { AuditRecord } from "../audit/audit.events";
import type { AuditService } from "../audit/audit.service";
import type { Database } from "../db/schema";
import { DomainError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";
import type {
  OnCallDesignee,
  OnCallMember,
  SlackOnCallRepository,
} from "./slack.on-call.repository";
import { SlackOnCallService } from "./slack.on-call.service";

/**
 * The on-call designee (#543): who a *DM on-call* route reaches, who could be chosen, and the
 * one write that changes it — over an in-memory `on_call_assignments` that keeps V132's two
 * rules (one active row per workspace, and only for a member with a linked identity), so a
 * service that skipped its own checks would fail here as it would against the database.
 */

const ORG = "org-acme";
const OTHER = "org-other";
const ADMIN = "u-admin";
const NOW = new Date("2026-10-12T14:02:11.000Z");

/** One `on_call_assignments` row. */
interface Assignment {
  readonly organizationId: string;
  readonly memberId: string;
  active: boolean;
  readonly assignedBy: string;
  readonly assignedAt: Date;
}

/** An in-memory stand-in for the on-call statements. */
class FakeOnCallStore {
  /** Every member, by workspace. */
  readonly members = new Map<string, OnCallMember[]>();
  /** Member ids with a linked identity on their workspace's active Slack connection. */
  readonly linked = new Set<string>();
  /** `on_call_assignments`, oldest first. */
  readonly assignments: Assignment[] = [];
  /** How many transactions ran. */
  transactions = 0;

  /**
   * Add a member.
   *
   * @param organizationId - Their workspace.
   * @param memberId - Their member row.
   * @param name - Their name.
   * @param linked - Whether their Slack identity is linked.
   * @returns This store.
   */
  member(organizationId: string, memberId: string, name: string, linked = true): this {
    this.members.set(organizationId, [
      ...(this.members.get(organizationId) ?? []),
      { memberId, name },
    ]);
    if (linked) this.linked.add(memberId);
    return this;
  }

  /** The workspace's active assignment. */
  private active(organizationId: string): Assignment | undefined {
    return this.assignments.find((row) => row.organizationId === organizationId && row.active);
  }

  /**
   * The repository over this store.
   *
   * @returns A stand-in with the real repository's methods.
   */
  repository(): SlackOnCallRepository {
    const of = (organizationId: string): OnCallMember[] => this.members.get(organizationId) ?? [];

    return {
      designee: (organizationId: string): Promise<OnCallDesignee | undefined> => {
        const row = this.active(organizationId);
        const member = of(organizationId).find((m) => m.memberId === row?.memberId);

        return Promise.resolve(
          row === undefined || member === undefined
            ? undefined
            : { ...member, assignedAt: row.assignedAt },
        );
      },
      linkedMembers: (organizationId: string) =>
        Promise.resolve(of(organizationId).filter((m) => this.linked.has(m.memberId))),
      member: (organizationId: string, memberId: string) =>
        Promise.resolve(of(organizationId).find((m) => m.memberId === memberId)),
      transaction: async <T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> => {
        const before = this.assignments.map((row) => ({ ...row }));

        this.transactions += 1;

        try {
          return await work({} as Transaction<Database>);
        } catch (error) {
          this.assignments.splice(0, this.assignments.length, ...before);
          throw error;
        }
      },
      lockActive: (_trx: Transaction<Database>, organizationId: string) =>
        Promise.resolve(this.active(organizationId)?.memberId ?? null),
      standDown: (_trx: Transaction<Database>, organizationId: string) => {
        for (const row of this.assignments) {
          if (row.organizationId === organizationId) row.active = false;
        }
        return Promise.resolve();
      },
      assign: (
        _trx: Transaction<Database>,
        organizationId: string,
        memberId: string,
        assignedBy: string,
      ) => {
        if (this.active(organizationId) !== undefined) {
          return Promise.reject(new Error("on_call_assignments_one_active"));
        }
        if (!this.linked.has(memberId)) {
          return Promise.reject(new Error("on_call_assignments_designee_linked"));
        }

        this.assignments.push({
          organizationId,
          memberId,
          active: true,
          assignedBy,
          assignedAt: NOW,
        });
        return Promise.resolve();
      },
    } as unknown as SlackOnCallRepository;
  }
}

/**
 * The service over a workspace of three: Maya and Ken linked, Priya not — and another workspace
 * with one linked member of its own.
 *
 * @returns The service, its store and what was audited.
 */
function harness(): { service: SlackOnCallService; store: FakeOnCallStore; trail: AuditRecord[] } {
  const store = new FakeOnCallStore()
    .member(ORG, "mem-maya", "Maya Chen")
    .member(ORG, "mem-ken", "Ken Suenobu")
    .member(ORG, "mem-priya", "Priya Nair", false)
    .member(OTHER, "mem-omar", "Omar Haddad");
  const trail: AuditRecord[] = [];
  const audit = {
    record: (event: AuditRecord) => {
      trail.push(event);
      return Promise.resolve("audit-id");
    },
  } as unknown as AuditService;

  return { service: new SlackOnCallService(store.repository(), audit), store, trail };
}

/**
 * The refusal a call raises.
 *
 * @param call - The call.
 * @returns What it threw.
 */
async function refusal(call: Promise<unknown>): Promise<DomainError> {
  const error = await call.catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(DomainError);
  return error as DomainError;
}

describe("reading who is on call", () => {
  it("answers nobody, and the linked members by name, before anyone is chosen", async () => {
    const { service } = harness();

    expect(await service.read(ORG)).toEqual({
      scope: "decisions",
      designee: null,
      assignedAt: null,
      // Priya has no linked identity, so she cannot be DMed and is not offered.
      candidates: [
        { memberId: "mem-ken", name: "Ken Suenobu" },
        { memberId: "mem-maya", name: "Maya Chen" },
      ],
    });
  });

  it("names the designee, when they were chosen, and that a DM reaches them", async () => {
    const { service } = harness();

    await service.assign(ORG, ADMIN, "mem-maya");

    expect(await service.read(ORG)).toMatchObject({
      designee: { memberId: "mem-maya", name: "Maya Chen", linked: true },
      assignedAt: NOW.toISOString(),
    });
  });

  it("says a designee whose link is gone is not linked, and stops offering them", async () => {
    const { service, store } = harness();

    await service.assign(ORG, ADMIN, "mem-maya");
    // The connection stopped working: nobody on it is reachable any more.
    store.linked.clear();

    expect(await service.read(ORG)).toMatchObject({
      designee: { memberId: "mem-maya", name: "Maya Chen", linked: false },
      candidates: [],
    });
  });

  it("orders candidates who share a name by their member id", async () => {
    const { service, store } = harness();
    store.member(ORG, "mem-a", "Maya Chen");

    expect((await service.read(ORG)).candidates.map((c) => c.memberId)).toEqual([
      "mem-ken",
      "mem-a",
      "mem-maya",
    ]);
  });
});

describe("choosing who is on call", () => {
  it("puts a linked member on call, as the person who chose, and answers the resource", async () => {
    const { service, store } = harness();

    const answer = await service.assign(ORG, ADMIN, "mem-ken");

    expect(answer.designee).toEqual({ memberId: "mem-ken", name: "Ken Suenobu", linked: true });
    expect(store.assignments).toEqual([
      {
        organizationId: ORG,
        memberId: "mem-ken",
        active: true,
        assignedBy: ADMIN,
        assignedAt: NOW,
      },
    ]);
  });

  it("replaces the designee in one transaction, keeping the earlier assignment inactive", async () => {
    const { service, store } = harness();

    await service.assign(ORG, ADMIN, "mem-ken");
    const answer = await service.assign(ORG, ADMIN, "mem-maya");

    expect(answer.designee?.memberId).toBe("mem-maya");
    expect(store.assignments.map((row) => [row.memberId, row.active])).toEqual([
      ["mem-ken", false],
      ["mem-maya", true],
    ]);
    expect(store.transactions).toBe(2);
  });

  it("leaves nobody on call for null", async () => {
    const { service, store } = harness();

    await service.assign(ORG, ADMIN, "mem-ken");
    const answer = await service.assign(ORG, ADMIN, null);

    expect(answer).toMatchObject({ designee: null, assignedAt: null });
    expect(store.assignments.map((row) => [row.memberId, row.active])).toEqual([
      ["mem-ken", false],
    ]);
  });

  it.each([
    ["an id that names nobody", "mem-nobody"],
    ["another workspace's member", "mem-omar"],
  ])("answers 404 chat_member_not_found for %s", async (_label, memberId) => {
    const { service, store, trail } = harness();

    const error = await refusal(service.assign(ORG, ADMIN, memberId));

    expect(error).toBeInstanceOf(NotFoundError);
    expect([error.code, error.getStatus()]).toEqual(["chat_member_not_found", 404]);
    expect(error.message).toBe("This workspace has no such member.");
    expect(store.transactions).toBe(0);
    expect(trail).toHaveLength(0);
  });

  it("answers 422 chat_on_call_not_linked for a member with no Slack identity, before the database would", async () => {
    const { service, store, trail } = harness();
    const message =
      "Priya Nair has not linked a Slack account, so an on-call DM could not reach them. They link it with /ouro link in Slack.";

    await service.assign(ORG, ADMIN, "mem-ken");
    const error = await refusal(service.assign(ORG, ADMIN, "mem-priya"));

    expect(error).toBeInstanceOf(InvalidRequestError);
    expect([error.code, error.getStatus()]).toEqual(["chat_on_call_not_linked", 422]);
    expect(error.message).toBe(message);
    expect(error.envelope().details).toEqual({ fields: { memberId: [message] } });
    // Ken is still on call: the refusal came before anything was stood down.
    expect(store.transactions).toBe(1);
    expect((await service.read(ORG)).designee?.memberId).toBe("mem-ken");
    expect(trail).toHaveLength(1);
  });
});

describe("the audit of an on-call change", () => {
  it("records who was on call and who is, for a first choice, a replacement and a clearing", async () => {
    const { service, trail } = harness();

    await service.assign(ORG, ADMIN, "mem-ken");
    await service.assign(ORG, ADMIN, "mem-maya");
    await service.assign(ORG, ADMIN, null);

    expect(trail.map((event) => event.detail)).toEqual([
      { scope: "decisions", previousMemberId: null, memberId: "mem-ken" },
      { scope: "decisions", previousMemberId: "mem-ken", memberId: "mem-maya" },
      { scope: "decisions", previousMemberId: "mem-maya", memberId: null },
    ]);
    expect(trail[0]).toMatchObject({
      organizationId: ORG,
      actorId: ADMIN,
      action: "chat.on_call_changed",
      subjectType: "on_call_assignment",
      subjectId: "decisions",
    });
  });

  it("writes nothing, and nothing new, when the member named is already on call — or nobody is", async () => {
    const { service, store, trail } = harness();

    await service.assign(ORG, ADMIN, null);
    await service.assign(ORG, ADMIN, "mem-ken");
    await service.assign(ORG, ADMIN, "mem-ken");

    expect(trail).toHaveLength(1);
    expect(store.assignments).toHaveLength(1);
  });
});

describe("tenant isolation", () => {
  it("reads and writes only the caller's workspace", async () => {
    const { service, store, trail } = harness();

    await service.assign(OTHER, "u-their-admin", "mem-omar");
    await service.assign(ORG, ADMIN, "mem-maya");

    expect(await service.read(ORG)).toMatchObject({
      designee: { memberId: "mem-maya" },
      candidates: [
        { memberId: "mem-ken", name: "Ken Suenobu" },
        { memberId: "mem-maya", name: "Maya Chen" },
      ],
    });
    expect(await service.read(OTHER)).toMatchObject({
      designee: { memberId: "mem-omar" },
      candidates: [{ memberId: "mem-omar", name: "Omar Haddad" }],
    });

    // Clearing one workspace's designee leaves the other's standing.
    await service.assign(ORG, ADMIN, null);

    expect((await service.read(OTHER)).designee?.memberId).toBe("mem-omar");
    expect(store.assignments.filter((row) => row.active).map((row) => row.organizationId)).toEqual([
      OTHER,
    ]);
    expect(trail.map((event) => event.organizationId)).toEqual([OTHER, ORG, ORG]);
  });

  it("refuses a member of this workspace named from another", async () => {
    const { service } = harness();

    const error = await refusal(service.assign(OTHER, "u-their-admin", "mem-maya"));

    expect(error.code).toBe("chat_member_not_found");
  });
});
