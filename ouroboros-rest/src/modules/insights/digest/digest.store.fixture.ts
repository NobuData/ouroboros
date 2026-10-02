/**
 * The digest's storage, in memory (#440) — `DigestRepository`'s methods over arrays, with the
 * two rules of V084 a runner's correctness rests on kept as the database keeps them: a slot is
 * claimed by one run, and an attempt at a recipient is claimed by one sender.
 *
 * The SQL itself is proven by `digest.integration-spec.ts`; this is for suites that ask what the
 * service and the runner *do*, quickly and without a database.
 */

import type { InsightsDigestSendStatus } from "../../db/schema";
import type {
  DigestRecipient,
  DigestRepository,
  DigestRunRow,
  DigestScheduleRow,
  DigestSendRow,
  RunClaimState,
  SendClaim,
  SubscribedWorkspace,
  UnsubscribeTarget,
} from "./digest.repository";

/** A subscription row. */
interface Subscription {
  organizationId: string;
  userId: string;
  createdAt: Date;
}

/** A send row. */
export interface StoredSend extends SendClaim {
  id: string;
  status: InsightsDigestSendStatus;
  error: string | null;
  claimedAt: Date;
}

/** A run row, mutable. */
interface StoredRun {
  id: string;
  organizationId: string;
  slotAt: Date;
  content: unknown;
  window: { from: string; to: string } | null;
  contentVersion: number | null;
  completedAt: Date | null;
}

export class FakeDigestStore {
  /** Workspaces by id. */
  readonly workspaces = new Map<string, string>();

  /** Members: `organizationId:userId` → the person's address. */
  readonly members = new Map<string, string>();

  readonly subscriptions: Subscription[] = [];

  readonly schedules = new Map<string, DigestScheduleRow>();

  /** Who saved each workspace's schedule. */
  readonly scheduleAuthors = new Map<string, string>();

  readonly runs: StoredRun[] = [];

  readonly sendRows: StoredSend[] = [];

  /** The instant `claimedAt` and `completedAt` are stamped with. */
  now = new Date("2026-08-08T12:00:00.000Z");

  /** The store, typed as the repository it stands in for. */
  get repository(): DigestRepository {
    return this as unknown as DigestRepository;
  }

  /**
   * A workspace with one member.
   *
   * @param organizationId - The workspace.
   * @param name - Its name.
   * @returns The store, for chaining.
   */
  workspace(organizationId: string, name: string): this {
    this.workspaces.set(organizationId, name);

    return this;
  }

  /**
   * Make somebody a member, and — by default — a subscriber since long before any slot.
   *
   * @param organizationId - The workspace.
   * @param userId - The person.
   * @param email - Their address.
   * @param subscribedAt - When they subscribed; null for a member who never did.
   * @returns The store, for chaining.
   */
  member(
    organizationId: string,
    userId: string,
    email: string,
    subscribedAt: Date | null = new Date("2026-01-01T00:00:00.000Z"),
  ): this {
    this.members.set(`${organizationId}:${userId}`, email);

    if (subscribedAt !== null) {
      this.subscriptions.push({ organizationId, userId, createdAt: subscribedAt });
    }

    return this;
  }

  subscribed(organizationId: string, userId: string): Promise<boolean> {
    return Promise.resolve(this.find(organizationId, userId) !== undefined);
  }

  subscribe(organizationId: string, userId: string): Promise<void> {
    if (this.find(organizationId, userId) === undefined) {
      this.subscriptions.push({ organizationId, userId, createdAt: this.now });
    }

    return Promise.resolve();
  }

  unsubscribe(organizationId: string, userId: string): Promise<void> {
    const index = this.subscriptions.findIndex(
      (row) => row.organizationId === organizationId && row.userId === userId,
    );

    if (index >= 0) {
      this.subscriptions.splice(index, 1);
    }

    return Promise.resolve();
  }

  schedule(organizationId: string): Promise<DigestScheduleRow | undefined> {
    return Promise.resolve(this.schedules.get(organizationId));
  }

  saveSchedule(
    organizationId: string,
    schedule: DigestScheduleRow,
    updatedBy: string,
  ): Promise<void> {
    this.schedules.set(organizationId, schedule);
    this.scheduleAuthors.set(organizationId, updatedBy);

    return Promise.resolve();
  }

  subscribedWorkspaces(): Promise<SubscribedWorkspace[]> {
    return Promise.resolve(
      [...this.workspaces]
        .filter(([organizationId]) =>
          this.subscriptions.some(
            (row) =>
              row.organizationId === organizationId &&
              this.members.has(`${organizationId}:${row.userId}`),
          ),
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([organizationId, name]) => ({
          organizationId,
          name,
          schedule: this.schedules.get(organizationId),
        })),
    );
  }

  recipients(organizationId: string, slotAt: Date): Promise<DigestRecipient[]> {
    return Promise.resolve(
      this.subscriptions
        .filter(
          (row) =>
            row.organizationId === organizationId &&
            row.createdAt.getTime() <= slotAt.getTime() &&
            this.members.has(`${organizationId}:${row.userId}`),
        )
        .map((row) => ({
          userId: row.userId,
          email: this.members.get(`${organizationId}:${row.userId}`) ?? "",
        }))
        .sort((a, b) => a.email.localeCompare(b.email)),
    );
  }

  claimRun(
    organizationId: string,
    decide: (state: RunClaimState) => Date | undefined,
  ): Promise<DigestRunRow | undefined> {
    const mine = this.runs.filter((run) => run.organizationId === organizationId);
    const latest = mine.reduce<Date | undefined>(
      (max, run) => (max === undefined || run.slotAt > max ? run.slotAt : max),
      undefined,
    );
    const slotAt = decide({ schedule: this.schedules.get(organizationId), latestSlotAt: latest });

    if (slotAt === undefined) {
      return Promise.resolve(undefined);
    }

    let run = mine.find((candidate) => candidate.slotAt.getTime() === slotAt.getTime());

    if (run === undefined) {
      run = {
        id: `run-${String(this.runs.length + 1)}`,
        organizationId,
        slotAt,
        content: null,
        window: null,
        contentVersion: null,
        completedAt: null,
      };
      this.runs.push(run);
    }

    return Promise.resolve({ ...run });
  }

  storeContent(
    runId: string,
    content: unknown,
    window: { readonly from: string; readonly to: string },
    contentVersion: number,
  ): Promise<DigestRunRow> {
    const run = this.run(runId);

    // Set once: a second assembly loses to the first, as V084's guard and the `where` ensure.
    if (run.content === null) {
      run.content = JSON.parse(JSON.stringify(content)) as unknown;
      run.window = { ...window };
      run.contentVersion = contentVersion;
    }

    return Promise.resolve({ ...run });
  }

  completeRun(runId: string): Promise<void> {
    const run = this.run(runId);

    run.completedAt ??= this.now;

    return Promise.resolve();
  }

  expireClaims(runId: string, olderThanMs: number): Promise<void> {
    const before = new Date(this.now.getTime() - olderThanMs);

    for (const send of this.sendRows) {
      if (send.runId === runId && send.status === "claimed" && send.claimedAt < before) {
        send.status = "failed";
        send.error = "The send was claimed and never confirmed.";
      }
    }

    return Promise.resolve();
  }

  sends(runId: string): Promise<DigestSendRow[]> {
    return Promise.resolve(
      this.sendRows
        .filter((send) => send.runId === runId)
        .map((send) => ({ userId: send.userId, attempt: send.attempt, status: send.status })),
    );
  }

  claimSend(claim: SendClaim): Promise<string | undefined> {
    const taken = this.sendRows.some(
      (send) =>
        send.runId === claim.runId &&
        send.userId === claim.userId &&
        send.attempt === claim.attempt,
    );

    if (taken) {
      return Promise.resolve(undefined);
    }

    const id = `send-${String(this.sendRows.length + 1)}`;

    this.sendRows.push({ ...claim, id, status: "claimed", error: null, claimedAt: this.now });

    return Promise.resolve(id);
  }

  settleSend(sendId: string, error?: string): Promise<void> {
    const send = this.sendRows.find((row) => row.id === sendId);

    if (send?.status === "claimed") {
      send.status = error === undefined ? "sent" : "failed";
      send.error = error ?? null;
    }

    return Promise.resolve();
  }

  unsubscribeTarget(tokenHash: string): Promise<UnsubscribeTarget | undefined> {
    const send = this.sendRows.find((row) => row.unsubscribeTokenHash === tokenHash);

    return Promise.resolve(
      send === undefined
        ? undefined
        : {
            organizationId: send.organizationId,
            workspaceName: this.workspaces.get(send.organizationId) ?? "",
            userId: send.userId,
          },
    );
  }

  /** One person's subscription to one workspace. */
  private find(organizationId: string, userId: string): Subscription | undefined {
    return this.subscriptions.find(
      (row) => row.organizationId === organizationId && row.userId === userId,
    );
  }

  /** A run by id. */
  private run(runId: string): StoredRun {
    const run = this.runs.find((candidate) => candidate.id === runId);

    if (run === undefined) {
      throw new Error(`No run ${runId}`);
    }

    return run;
  }
}
