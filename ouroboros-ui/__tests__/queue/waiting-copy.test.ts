import { describe, expect, it } from "vitest";

import { LIVE_EXECUTION_DOCS } from "@/app/loop/capability-copy";
import { POLICIES_PATH, PROVIDERS_PATH, REPOSITORIES_PATH, WORKFLOWS_PATH } from "@/app/paths";
import {
  type AdmissionReason,
  LIVE_LIMITS_DOCS,
  WAITING_COPY,
  sharedWaiting,
  waitingCopy,
} from "@/app/queue/waiting-copy";

/**
 * Why a queued issue waits (DI.4, #1312) — every admission reason the service can answer has
 * a label, a sentence and, unless the fix is an action on the item, a link to where it is
 * fixed. One case per code, so a reason added on the service is a failing test here.
 */

/** Every reason the contract names, in its own order. */
const REASONS: readonly AdmissionReason[] = [
  "deployment_disabled",
  "workspace_paused",
  "workspace_pending_delete",
  "no_executor",
  "concurrency_ceiling",
  "repository_disabled",
  "policy_not_dry_run",
  "workflow_unpublished",
  "route_not_invocable",
  "needs_confirmation",
];

describe("the words for each reason", () => {
  it("covers exactly the contract's reasons", () => {
    expect(Object.keys(WAITING_COPY).toSorted()).toEqual([...REASONS].toSorted());
  });

  it.each(REASONS)("gives %s a short label and one full sentence", (reason) => {
    const copy = waitingCopy({ reason });

    expect(copy.label.length).toBeGreaterThan(0);
    expect(copy.label.length).toBeLessThanOrEqual(24);
    expect(copy.sentence).toMatch(/^[A-Z].*\.$/);
  });

  it.each([
    ["deployment_disabled", LIVE_EXECUTION_DOCS],
    ["concurrency_ceiling", LIVE_LIMITS_DOCS],
    ["repository_disabled", REPOSITORIES_PATH],
    ["policy_not_dry_run", POLICIES_PATH],
    ["workflow_unpublished", WORKFLOWS_PATH],
    ["route_not_invocable", PROVIDERS_PATH],
    ["workspace_paused", "/settings#danger"],
    ["workspace_pending_delete", "/settings#danger"],
  ] as const)("points %s at where it is fixed", (reason, href) => {
    expect(waitingCopy({ reason }).fix?.href).toBe(href);
  });

  it("links documentation out, and the application in", () => {
    expect(waitingCopy({ reason: "deployment_disabled" }).fix?.external).toBe(true);
    expect(waitingCopy({ reason: "policy_not_dry_run" }).fix?.external).toBe(false);
  });

  it("names no link for needs_confirmation — the fix is the item's own Confirm", () => {
    expect(waitingCopy({ reason: "needs_confirmation" }).fix).toBeNull();
  });

  it("says a policy that is not dry-run cannot start, and why", () => {
    expect(waitingCopy({ reason: "policy_not_dry_run" }).sentence).toContain("draft pull requests");
  });
});

describe("a reason a whole list shares", () => {
  const off = { reason: "deployment_disabled", scope: "workspace" } as const;
  const full = { reason: "concurrency_ceiling", scope: "workspace" } as const;
  const unconfirmed = { reason: "needs_confirmation", scope: "item" } as const;

  it("is the workspace reason every row carries", () => {
    expect(sharedWaiting([off, off, off])).toEqual(off);
  });

  it("is nothing for an item's own reason, even when every row has it", () => {
    expect(sharedWaiting([unconfirmed, unconfirmed])).toBeNull();
  });

  it("is nothing when the rows disagree, or one is not waiting", () => {
    expect(sharedWaiting([off, full])).toBeNull();
    expect(sharedWaiting([off, null])).toBeNull();
  });

  it("is nothing for an empty list", () => {
    expect(sharedWaiting([])).toBeNull();
  });
});
