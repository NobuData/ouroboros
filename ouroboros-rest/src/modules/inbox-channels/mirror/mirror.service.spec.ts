import type { AppConfigService } from "../../config/config.service";
import type { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import { DecisionLifecycle } from "../../decisions/decision.lifecycle";
import { SEEDED_PAYLOADS, SHIPPED_KINDS } from "../../decisions/decision.kinds.fixture";
import { renderDecision } from "../../decisions/decision.templates";
import type { PublishedDecisionKind } from "../../decisions/decision.types";
import { prSourceHasNoPullRequests } from "../../pull-requests/pr-sync.errors";
import type { PrSyncService } from "../../pull-requests/pr-sync.service";
import type { PrCommentInput, PrCommentResult } from "../../ticket-sources/ticket-source.pr";
import type {
  MirrorItem,
  MirrorPr,
  MirrorRepository,
  MirrorResolutionRow,
  MirrorRow,
  MirrorSkipReason,
  PostedComment,
} from "./mirror.repository";
import { MAX_MIRROR_ATTEMPTS, DecisionMirrorService } from "./mirror.service";

const ORG = "org-1";
const ITEM = "6a1f0e1c-0000-4000-8000-000000000001";
const RUN = "11111111-0000-4000-8000-000000000001";
const PR = "22222222-0000-4000-8000-000000000002";

/** A V100 mirror table, a decision item and the PR rows, in memory. */
class FakeMirrorStore {
  rows = new Map<string, MirrorRow>();

  items = new Map<string, MirrorItem>();

  resolutions = new Map<string, MirrorResolutionRow>();

  prs = new Map<string, MirrorPr & { runId: string | null }>();

  repository(): MirrorRepository {
    const update = (itemId: string, change: Partial<MirrorRow>) => {
      const row = this.rows.get(itemId);

      if (row !== undefined) {
        this.rows.set(itemId, { ...row, ...change });
      }
    };

    return {
      bump: (organizationId: string, itemId: string) => {
        const row = this.rows.get(itemId);
        const revision = (row?.revision ?? 0) + 1;

        this.rows.set(itemId, {
          itemId,
          organizationId,
          revision,
          shownRevision: row?.shownRevision ?? null,
          prId: row?.prId ?? null,
          commentId: row?.commentId ?? null,
          commentUrl: row?.commentUrl ?? null,
          skipReason: row?.skipReason ?? null,
          lastError: row?.lastError ?? null,
          attempts: row?.attempts ?? 0,
        });

        return Promise.resolve(revision);
      },
      row: (itemId: string) => Promise.resolve(this.rows.get(itemId)),
      item: (itemId: string) => Promise.resolve(this.items.get(itemId)),
      resolution: (itemId: string) => Promise.resolve(this.resolutions.get(itemId)),
      pr: (_org: string, prId: string) => Promise.resolve(this.prs.get(prId)),
      prForRun: (_org: string, runId: string) =>
        Promise.resolve([...this.prs.values()].find((pr) => pr.runId === runId)),
      recordPosted: (itemId: string, revision: number, posted: PostedComment) => {
        const row = this.rows.get(itemId);

        update(itemId, {
          shownRevision: Math.max(row?.shownRevision ?? 0, revision),
          prId: posted.prId,
          commentId: posted.commentId,
          commentUrl: posted.commentUrl,
          skipReason: null,
          lastError: null,
          attempts: 0,
        });

        return Promise.resolve();
      },
      recordSkipped: (itemId: string, reason: MirrorSkipReason) => {
        update(itemId, { skipReason: reason, lastError: null, attempts: 0 });

        return Promise.resolve();
      },
      recordFailed: (itemId: string, error: string) => {
        update(itemId, {
          lastError: error,
          attempts: (this.rows.get(itemId)?.attempts ?? 0) + 1,
        });

        return Promise.resolve();
      },
      pending: (maxAttempts: number) =>
        Promise.resolve(
          [...this.rows.values()]
            .filter(
              (row) =>
                row.shownRevision !== row.revision &&
                row.skipReason === null &&
                row.attempts < maxAttempts,
            )
            .map((row) => row.itemId),
        ),
    } as unknown as MirrorRepository;
  }
}

/** A git host that keeps one comment per key, as the SPI promises. */
class FakeHost {
  comments = new Map<string, { id: string; body: string; pr: number; edits: number }>();

  calls: { sourceId: string; number: number; comment: PrCommentInput }[] = [];

  /** The next calls to fail, with this error. */
  failures: Error[] = [];

  service(): PrSyncService {
    return {
      comment: (_org: string, sourceId: string, number: number, comment: PrCommentInput) => {
        this.calls.push({ sourceId, number, comment });

        const failure = this.failures.shift();

        if (failure !== undefined) {
          return Promise.reject(failure);
        }

        const existing = this.comments.get(comment.key);

        if (existing === undefined) {
          const id = `c-${String(this.comments.size + 1)}`;

          this.comments.set(comment.key, { id, body: comment.body, pr: number, edits: 0 });

          return Promise.resolve<PrCommentResult>({
            commentId: id,
            url: `https://github.test/pull/${String(number)}#${id}`,
            mode: "created",
          });
        }

        const mode = existing.body === comment.body ? "unchanged" : "edited";

        existing.edits += mode === "edited" ? 1 : 0;
        existing.body = comment.body;

        return Promise.resolve<PrCommentResult>({ commentId: existing.id, url: null, mode });
      },
    } as unknown as PrSyncService;
  }
}

describe("DecisionMirrorService (#463)", () => {
  let store: FakeMirrorStore;
  let host: FakeHost;
  let lifecycle: DecisionLifecycle;
  let mirror: DecisionMirrorService;

  const registry = {
    pinnedKind: (kindId: string) => Promise.resolve(SHIPPED_KINDS[kindId]),
    render: (kind: PublishedDecisionKind, payload: Record<string, unknown>, format: "markdown") =>
      renderDecision(kind, payload, format),
  } as unknown as DecisionKindRegistry;

  /** File a merge-approval item with a pr ref. */
  function fileItem(
    refs: unknown = [
      { type: "run", id: RUN, label: "loop #1851" },
      { type: "pr", id: PR, label: "PR #509" },
    ],
  ): void {
    store.items.set(ITEM, {
      id: ITEM,
      organizationId: ORG,
      kindId: "merge_approval",
      kindVersion: 1,
      severity: "err",
      status: "open",
      payload: SEEDED_PAYLOADS.merge_approval ?? {},
      refs,
    });
  }

  beforeEach(() => {
    store = new FakeMirrorStore();
    host = new FakeHost();
    lifecycle = new DecisionLifecycle();
    store.prs.set(PR, { id: PR, sourceId: "source-gh", number: 509, runId: RUN });
    mirror = new DecisionMirrorService(store.repository(), registry, host.service(), lifecycle, {
      uiUrl: "https://ouro.example",
    } as AppConfigService);
    mirror.onModuleInit();
  });

  afterEach(() => {
    mirror.onModuleDestroy();
  });

  it("posts exactly one comment for a decision with a PR ref", async () => {
    fileItem();

    expect(await mirror.changed(ORG, ITEM)).toBe("posted");
    expect(host.comments.size).toBe(1);
    expect(host.calls[0]).toMatchObject({ sourceId: "source-gh", number: 509 });
    expect(host.calls[0]?.comment.key).toBe(`decision-${ITEM}`);
    expect(host.calls[0]?.comment.body).toContain("**⚠ Needs you** · err");
    expect(store.rows.get(ITEM)).toMatchObject({ shownRevision: 1, commentId: "c-1", prId: PR });
  });

  it("does not post again on a retry or a redeploy", async () => {
    fileItem();
    await mirror.changed(ORG, ITEM);

    // A retry (nothing changed) and a new process (a fresh service over the same rows).
    expect(await mirror.sync(ITEM)).toBe("current");
    const redeployed = new DecisionMirrorService(
      store.repository(),
      registry,
      host.service(),
      lifecycle,
      { uiUrl: "https://ouro.example" } as AppConfigService,
    );

    expect(await redeployed.sweep()).toEqual(new Map());
    expect(host.calls).toHaveLength(1);
    expect(host.comments.size).toBe(1);
  });

  it("edits the same comment on resolution to show the outcome and the actor", async () => {
    fileItem();
    await mirror.changed(ORG, ITEM);

    store.items.set(ITEM, { ...(store.items.get(ITEM) as MirrorItem), status: "resolved" });
    store.resolutions.set(ITEM, {
      resolver: "human",
      policy: null,
      actionId: "approve_merge",
      actorName: "Ken",
      channel: "web",
      resolvedAt: new Date("2026-10-04T09:12:00Z"),
    });

    expect(await mirror.changed(ORG, ITEM)).toBe("posted");
    expect(host.comments.size).toBe(1);

    const comment = host.comments.get(`decision-${ITEM}`);

    expect(comment?.edits).toBe(1);
    expect(comment?.body).toContain("**✓ Answered** — approved by Ken · in Ouroboros");
    expect(comment?.body).not.toContain("Answer →");
  });

  it("hears the lifecycle — a filed event mirrors without the emitter waiting", async () => {
    fileItem();

    lifecycle.emit({ type: "filed", itemId: ITEM, organizationId: ORG, kindId: "merge_approval" });
    await new Promise((resolve) => setImmediate(resolve));
    await mirror.sync(ITEM);

    expect(host.comments.size).toBe(1);
  });

  it("falls back to the PR the item's run opened", async () => {
    fileItem([{ type: "run", id: RUN, label: "loop #1851" }]);

    expect(await mirror.changed(ORG, ITEM)).toBe("posted");
    expect(host.calls[0]?.number).toBe(509);
  });

  it("records honestly when there is no PR to comment on", async () => {
    fileItem([{ type: "run", id: "99999999-0000-4000-8000-000000000009", label: "loop #2" }]);

    expect(await mirror.changed(ORG, ITEM)).toBe("skipped");
    expect(store.rows.get(ITEM)?.skipReason).toBe("no_pr");
    expect(host.calls).toHaveLength(0);
  });

  it("records a source that cannot comment as having no comment surface", async () => {
    fileItem();
    host.failures.push(prSourceHasNoPullRequests("source-gh"));

    expect(await mirror.changed(ORG, ITEM)).toBe("skipped");
    expect(store.rows.get(ITEM)?.skipReason).toBe("no_comment_surface");
  });

  it("degrades honestly: a failure is recorded, nothing throws, and the sweep retries", async () => {
    fileItem();
    host.failures.push(new Error("GitHub said 502"));

    expect(await mirror.changed(ORG, ITEM)).toBe("failed");
    expect(store.rows.get(ITEM)).toMatchObject({
      lastError: "GitHub said 502",
      attempts: 1,
      shownRevision: null,
    });

    const outcomes = await mirror.sweep();

    expect(outcomes.get(ITEM)).toBe("posted");
    expect(store.rows.get(ITEM)).toMatchObject({ lastError: null, attempts: 0, shownRevision: 1 });
    expect(host.comments.size).toBe(1);
  });

  it("stops retrying after repeated failures until the item changes again", async () => {
    fileItem();

    for (let attempt = 0; attempt < MAX_MIRROR_ATTEMPTS; attempt += 1) {
      host.failures.push(new Error("down"));
      await (attempt === 0 ? mirror.changed(ORG, ITEM) : mirror.sweep());
    }

    expect(store.rows.get(ITEM)?.attempts).toBe(MAX_MIRROR_ATTEMPTS);
    expect(await mirror.sweep()).toEqual(new Map());

    // A new change is still heard directly.
    expect(await mirror.changed(ORG, ITEM)).toBe("posted");
  });

  it("serialises two changes of one item so the second edits the first's comment", async () => {
    fileItem();

    await Promise.all([mirror.changed(ORG, ITEM), mirror.changed(ORG, ITEM)]);

    expect(host.comments.size).toBe(1);
    expect(store.rows.get(ITEM)?.shownRevision).toBe(store.rows.get(ITEM)?.revision);
  });

  it("answers gone for an item that no longer exists", async () => {
    expect(await mirror.sync(ITEM)).toBe("gone");
  });
});
