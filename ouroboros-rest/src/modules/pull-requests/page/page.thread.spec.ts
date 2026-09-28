import type { AuditRecord } from "../../audit/audit.events";
import type { Requester } from "../../controls/controls.service";
import { TicketSourceError } from "../../ticket-sources/ticket-source.errors";
import type { ThreadRow } from "./page.repository";
import { FakePageStore, KEN, ORG, OTHER_ORG, PR, REV_1 } from "./page.store.fixture";
import { MIRROR_FAILED, ThreadActionsService, mirrorError, type ThreadHost } from "./page.thread";

/**
 * Resolving a review-thread entry over fakes
 * ([#368](https://github.com/NobuData/ouroboros/issues/368)): reply and resolve are one act, the
 * lifecycle is one-way, and the host mirror is answered rather than thrown.
 */

const ACTOR: Requester = { id: KEN.id, name: KEN.name, roles: ["member"] };

/** The seed's second opinion, resolved with its reply. */
const RESOLVED = "5eed0040-0000-4000-8000-000000005142";

/** The seed's policy entry. */
const POLICY = "5eed0040-0000-4000-8000-000000005143";

/** An objection nobody has answered yet. */
const OPEN: ThreadRow = {
  id: "5eed0040-0000-4000-8000-000000005144",
  revisionId: REV_1,
  revisionSeq: 1,
  authorKind: "human",
  authorName: "Priya N",
  tag: "second opinion",
  body: "The drain loop still allocates on overflow.",
  blocking: true,
  resolved: false,
  resolutionBody: null,
  simulated: false,
  createdAt: new Date("2026-09-27T14:33:00Z"),
};

/** The world a case runs in — the seeded thread plus {@link OPEN}. */
function world() {
  const store = new FakePageStore();
  const entries = [...store.threadRows.entries, OPEN];
  store.threadRows = { entries, entryCount: entries.length, openCount: 1 };

  const audit: AuditRecord[] = [];
  const host = {
    comment: jest.fn<ReturnType<ThreadHost["comment"]>, Parameters<ThreadHost["comment"]>>(() =>
      Promise.resolve({ commentId: "c-1", url: "https://git.example/pr/514#c-1", mode: "created" }),
    ),
  };
  const thread = new ThreadActionsService(store, host, {
    record: (event) => {
      audit.push(event);
      return Promise.resolve(String(audit.length));
    },
  });

  return { store, audit, host, thread };
}

describe("Reply and resolve", () => {
  it("resolves the entry with its reply, and the open count follows", async () => {
    const { thread, store, host } = world();

    const result = await thread.resolve(ORG, PR, OPEN.id, ACTOR, {
      reply: "Overflow path now drops the frame; no allocation.",
    });

    expect(result).toEqual({
      entry: {
        ...OPEN,
        resolved: true,
        resolutionBody: "Overflow path now drops the frame; no allocation.",
        createdAt: "2026-09-27T14:33:00.000Z",
      },
      mirror: { state: "not_requested", url: null, error: null },
    });
    expect(store.threadRows.openCount).toBe(0);
    expect(host.comment).not.toHaveBeenCalled();
  });

  it("resolves with no reply — an entry may simply be dealt with", async () => {
    const { thread } = world();

    const result = await thread.resolve(ORG, PR, OPEN.id, ACTOR, {});

    expect(result.entry).toMatchObject({ resolved: true, resolutionBody: null, blocking: true });
  });

  it("leaves who said it, and the watermark, exactly as they were", async () => {
    const { thread, store } = world();
    const seeded: ThreadRow = {
      ...OPEN,
      authorKind: "model",
      authorName: "cursor/composer-2",
      simulated: true,
    };
    store.threadRows = { ...store.threadRows, entries: [seeded] };

    const result = await thread.resolve(ORG, PR, OPEN.id, ACTOR, { reply: "Addressed." });

    expect(result.entry).toMatchObject({
      authorKind: "model",
      authorName: "cursor/composer-2",
      simulated: true,
      body: OPEN.body,
    });
  });

  it("audits the person and the arc, never the reply", async () => {
    const { thread, audit } = world();

    await thread.resolve(ORG, PR, OPEN.id, ACTOR, { reply: "Overflow path fixed." });

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      organizationId: ORG,
      actorId: KEN.id,
      action: "pr_thread.resolved",
      subjectType: "pr_thread_entry",
      subjectId: OPEN.id,
      detail: { pr_id: PR, was_blocking: true, replied: true, mirror: "not_requested" },
    });
    expect(JSON.stringify(audit[0])).not.toContain("Overflow path fixed.");
  });

  it("refuses an entry already resolved — a resolution and its reply are fixed", async () => {
    const { thread, store, audit } = world();

    await expect(
      thread.resolve(ORG, PR, RESOLVED, ACTOR, { reply: "Never mind." }),
    ).rejects.toMatchObject({ response: { code: "pr_thread_entry_resolved" } });
    expect(store.threadRows.entries.find((row) => row.id === RESOLVED)?.resolutionBody).toBe(
      "Addressed in attempt 4 — sampling decoupled from telemetry drain.",
    );
    expect(audit).toEqual([]);
  });

  it("refuses a policy entry — a rule is not an objection", async () => {
    const { thread } = world();

    await expect(thread.resolve(ORG, PR, POLICY, ACTOR, {})).rejects.toMatchObject({
      response: { code: "pr_thread_entry_not_resolvable" },
    });
  });

  it("answers 404 for an entry the thread does not have, and for another workspace's PR", async () => {
    const { thread } = world();

    await expect(
      thread.resolve(ORG, PR, "5eed0040-0000-4000-8000-000000009999", ACTOR, {}),
    ).rejects.toMatchObject({ response: { code: "pr_thread_entry_not_found" } });
    await expect(thread.resolve(OTHER_ORG, PR, OPEN.id, ACTOR, {})).rejects.toMatchObject({
      response: { code: "pull_request_not_found" },
    });
  });

  it("resolves on a merged PR too — the thread is this plane's record", async () => {
    const { thread, store } = world();
    store.head514 = { ...store.head514, state: "merged" };

    const result = await thread.resolve(ORG, PR, OPEN.id, ACTOR, {});

    expect(result.entry.resolved).toBe(true);
  });
});

describe("The host mirror", () => {
  it("posts the reply under the entry's key, signed by the person", async () => {
    const { thread, host, audit, store } = world();

    const result = await thread.resolve(ORG, PR, OPEN.id, ACTOR, {
      reply: "Overflow path fixed.",
      mirror: true,
    });

    expect(result.mirror).toEqual({
      state: "posted",
      url: "https://git.example/pr/514#c-1",
      error: null,
    });
    expect(host.comment).toHaveBeenCalledTimes(1);

    const [organizationId, sourceId, number, comment] = host.comment.mock.calls[0];

    expect([organizationId, sourceId, number]).toEqual([
      ORG,
      store.head514.sourceId,
      store.head514.number,
    ]);
    expect(comment.key).toBe(`thread.${OPEN.id}`);
    expect(comment.body).toContain("> Overflow path fixed.");
    expect(comment.body).toContain(`**Resolved by:** ${KEN.name}`);
    expect(audit[0].detail).toMatchObject({ mirror: "posted" });
  });

  it("refuses a mirror with nothing to post, before anything is written", async () => {
    const { thread, store, host } = world();

    await expect(thread.resolve(ORG, PR, OPEN.id, ACTOR, { mirror: true })).rejects.toMatchObject({
      response: { code: "pr_thread_mirror_needs_reply" },
    });
    expect(store.threadRows.openCount).toBe(1);
    expect(host.comment).not.toHaveBeenCalled();
  });

  it("answers a host refusal rather than throwing — the resolution stands", async () => {
    const { thread, host, audit } = world();
    host.comment.mockRejectedValueOnce(new TicketSourceError("rate_limit", "slow down"));

    const result = await thread.resolve(ORG, PR, OPEN.id, ACTOR, {
      reply: "Overflow path fixed.",
      mirror: true,
    });

    expect(result.entry.resolved).toBe(true);
    expect(result.mirror).toMatchObject({
      state: "failed",
      url: null,
      error: { code: "host_rate_limit" },
    });
    expect(audit[0].detail).toMatchObject({ mirror: "failed" });
  });

  it("says its own words for a failure that was not the host's", () => {
    expect(mirrorError(new Error("socket hang up"))).toEqual(MIRROR_FAILED);
    expect(mirrorError(new TicketSourceError("auth", "bad token")).code).toBe("host_auth");
  });
});
