import type { DecisionRef } from "../../decisions/decision.types";
import { PR_COMMENT_KEY } from "../../ticket-sources/ticket-source.pr";
import {
  composeMirrorComment,
  mirrorCommentKey,
  receiptLine,
  refRow,
  utcMinute,
  type MirrorCommentInput,
} from "./mirror.compose";

const UI = "https://ouro.example/";
const ITEM = "6a1f0e1c-0000-4000-8000-000000000001";
const REFS: DecisionRef[] = [
  { type: "run", id: "11111111-0000-4000-8000-000000000001", label: "loop #1851" },
  { type: "pr", id: "22222222-0000-4000-8000-000000000002", label: "PR #509" },
  { type: "ticket", id: "33333333-0000-4000-8000-000000000003", label: "issue #479" },
  { type: "path", id: "boot/rollback_flag.c", label: "boot/rollback_flag.c" },
];

/** An open item's input. */
function open(overrides: Partial<MirrorCommentInput> = {}): MirrorCommentInput {
  return {
    itemId: ITEM,
    severity: "err",
    prose: { question: "Approve merge for a refactor PR?", why: "Policy says so\\.", tags: [] },
    refs: REFS,
    uiUrl: UI,
    ...overrides,
  };
}

describe("the mirror comment (#463)", () => {
  it("says it needs you, with the question, the why, linked refs and an Answer link", () => {
    const body = composeMirrorComment(open());

    expect(body.split("\n")).toEqual([
      "**⚠ Needs you** · err",
      "",
      "**Approve merge for a refactor PR?**",
      "",
      "Policy says so\\.",
      "",
      "[loop \\#1851](https://ouro.example/runs/11111111-0000-4000-8000-000000000001) · " +
        "[PR \\#509](https://ouro.example/prs/22222222-0000-4000-8000-000000000002) · " +
        "issue \\#479 · `boot/rollback_flag.c`",
      "",
      `[Answer →](https://ouro.example/inbox?item=${ITEM})`,
    ]);
  });

  it("shows the outcome, the actor, the channel and the time once resolved, without the Answer link", () => {
    const body = composeMirrorComment(
      open({
        resolution: {
          resolver: "human",
          policy: null,
          actionId: "approve_merge",
          actorName: "Ken",
          channel: "email",
          resolvedAt: new Date("2026-10-04T09:12:41Z"),
        },
      }),
    );

    expect(body.split("\n")[0]).toBe(
      "**✓ Answered** — approved by Ken · by email · 2026-10-04 09:12 UTC",
    );
    expect(body).toContain("**Approve merge for a refactor PR?**");
    expect(body).not.toContain("Answer →");
  });

  it("says when a policy closed it, naming no person", () => {
    expect(
      receiptLine({
        resolver: "policy",
        policy: "source_resolved",
        actionId: "source_resolved",
        actorName: null,
        channel: "github",
        resolvedAt: new Date("2026-10-04T10:00:00Z"),
      }),
    ).toBe("**✓ Answered** — closed — settled elsewhere · on GitHub · 2026-10-04 10:00 UTC");
  });

  it("says an expired item no longer asks", () => {
    const body = composeMirrorComment(open({ expired: true }));

    expect(body.startsWith("**⌛ Expired**")).toBe(true);
    expect(body).not.toContain("Answer →");
  });

  it("escapes a person's name so it cannot inject Markdown", () => {
    expect(
      receiptLine({
        resolver: "human",
        policy: null,
        actionId: "confirm",
        actorName: "[evil](https://x.test)",
        channel: "web",
        resolvedAt: new Date("2026-10-04T10:00:00Z"),
      }),
    ).toContain("by \\[evil\\]\\(https://x\\.test\\)");
  });

  it("cannot be broken out of by a backtick in a path", () => {
    expect(refRow([{ type: "path", id: "a`b", label: "a`b" }], UI)).toBe("`a'b`");
  });

  it("leaves out an empty tag row", () => {
    expect(composeMirrorComment(open({ refs: [] }))).not.toContain(" · \n");
  });

  it("formats instants to the UTC minute", () => {
    expect(utcMinute(new Date("2026-01-02T03:04:59.999Z"))).toBe("2026-01-02 03:04 UTC");
  });

  it("keys one comment per item, inside the SPI's key grammar", () => {
    expect(mirrorCommentKey(ITEM)).toBe(`decision-${ITEM}`);
    expect(mirrorCommentKey(ITEM)).toMatch(PR_COMMENT_KEY);
  });
});
