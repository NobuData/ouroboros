import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";

import { BOOTSTRAP_WORKFLOW_SLUGS } from "../workflows/registry.service";
import {
  QUEUE_ERRORS,
  QUEUE_ISSUE_PROBLEMS,
  queueIssuesConflict,
  queueIssuesNotFound,
  queueIssuesNotQueueable,
  queueWorkflowUnknown,
} from "./queue.errors";

/**
 * The codes, and the promise that the document is the registry — `estimation.errors.spec.ts`'s
 * shape, for its reason: a code is only useful if it is stable and if a client can discover what
 * it means, and `openapi.yaml` is where the second half lives.
 *
 * The statuses get cases of their own because M.3's three refusals are three *different*
 * statuses on purpose, and picking the wrong one reads fine and makes a client branch wrongly
 * for years. So does the per-issue shape: the ticket's criterion is that N.4
 * ([#118](https://github.com/NobuData/ouroboros/issues/118)) can **name the offenders** rather
 * than render a generic failure, and a refusal that carried one scalar id could not.
 */

/** The module root, where the authoritative specification is committed. */
const MODULE_ROOT = join(__dirname, "..", "..", "..");

/** The authoritative specification, read once. */
const SPECIFICATION = readFileSync(join(MODULE_ROOT, "openapi.yaml"), "utf8");

const ISSUE = "5eed0018-0000-4000-8000-000000000485";
const OTHER = "5eed0018-0000-4000-8000-000000000483";

describe("the codes", () => {
  it.each(Object.values(QUEUE_ERRORS))("names %s as a stable, machine-readable code", (code) => {
    expect(code).toMatch(/^[a-z][a-z_]*[a-z]$/);
  });

  it.each(Object.values(QUEUE_ISSUE_PROBLEMS))(
    "names %s as a stable, machine-readable code",
    (code) => {
      expect(code).toMatch(/^[a-z][a-z_]*[a-z]$/);
    },
  );

  it.each(Object.values(QUEUE_ERRORS))("documents %s in openapi.yaml", (code) => {
    expect(SPECIFICATION).toContain(code);
  });

  it.each(Object.values(QUEUE_ISSUE_PROBLEMS))("documents %s in openapi.yaml", (code) => {
    expect(SPECIFICATION).toContain(code);
  });

  it("keeps the four refusals apart", () => {
    // Three of them are three different statuses on purpose. The fourth shares `422` with
    // `queue_issues_not_queueable` and is a different code because it is about a different
    // thing: one is the state of the issues, the other is a workflow the workspace does not
    // have — and a client that had to read the message to tell them apart would branch wrongly.
    expect(new Set(Object.values(QUEUE_ERRORS)).size).toBe(4);
  });
});

describe("a workflow this workspace does not have", () => {
  it("is a 422 naming the slug and the vocabulary it was held to", () => {
    // The ticket's fourth criterion from the refusal's side: what the menu lists and what this
    // accepts are one list, so a refusal can hand back the list rather than a shrug.
    const error = queueWorkflowUnknown("midnight-loop", ["standard-fix", "hotfix-p0"]);

    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(error.envelope().code).toBe(QUEUE_ERRORS.workflowUnknown);
    expect(error.envelope().details).toEqual({
      workflow: "midnight-loop",
      offered: ["standard-fix", "hotfix-p0"],
    });
  });

  it("names the slug in the message, because there is exactly one offender", () => {
    // Not bulk-shaped, unlike the three above: one request names one workflow, and it is not
    // an issue — which is why `details` carries the vocabulary instead of a list of issues.
    const { message, details } = queueWorkflowUnknown("midnight-loop", [
      ...BOOTSTRAP_WORKFLOW_SLUGS,
    ]).envelope();

    expect(message).toContain("midnight-loop");
    expect(details).not.toHaveProperty("issues");
  });
});

describe("ids this workspace does not have", () => {
  it("is a 404, whether they are missing or somebody else's", () => {
    // The ticket's *cross-org ids → 404*. A `403` would confirm that a guessed id names a real
    // issue somewhere, which is the whole of what an enumerator is trying to learn.
    const error = queueIssuesNotFound([{ issueId: ISSUE, code: QUEUE_ISSUE_PROBLEMS.notFound }]);

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.envelope().code).toBe(QUEUE_ERRORS.notFound);
  });

  it("echoes back only the ids the caller sent", () => {
    // No number, no title, no status: an issue this workspace cannot see has no fact this
    // request is entitled to learn.
    const error = queueIssuesNotFound([
      { issueId: ISSUE, code: QUEUE_ISSUE_PROBLEMS.notFound },
      { issueId: OTHER, code: QUEUE_ISSUE_PROBLEMS.notFound },
    ]);

    expect(error.envelope().details).toEqual({
      issues: [
        { issueId: ISSUE, code: "issue_not_found" },
        { issueId: OTHER, code: "issue_not_found" },
      ],
    });
    expect(error.envelope().message).not.toContain("5eed0018");
  });
});

describe("issues that are not ready", () => {
  it("is a 422 naming each offender and the status it is actually in", () => {
    // *"422 with per-issue codes naming the offenders"* — the acceptance criterion, and the
    // reason `details.issues` is a list rather than one id.
    const error = queueIssuesNotQueueable([
      {
        issueId: ISSUE,
        code: QUEUE_ISSUE_PROBLEMS.notSized,
        issueNumber: 483,
        sizingStatus: "estimating",
      },
    ]);

    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(error.envelope().code).toBe(QUEUE_ERRORS.notQueueable);
    expect(error.envelope().details).toEqual({
      issues: [
        {
          issueId: ISSUE,
          code: "issue_not_sized",
          issueNumber: 483,
          sizingStatus: "estimating",
        },
      ],
    });
  });

  it("says what a person can do about it rather than that something failed", () => {
    const { message } = queueIssuesNotQueueable([
      { issueId: ISSUE, code: QUEUE_ISSUE_PROBLEMS.notSized },
    ]).envelope();

    expect(message).toContain("sized");
  });

  it("distinguishes an unsized issue from a sized one with no estimate", () => {
    // Different facts: one is the ordinary pipeline state, and the other is a `sized` issue
    // whose estimate row has been deleted out from under it.
    expect(QUEUE_ISSUE_PROBLEMS.notSized).not.toBe(QUEUE_ISSUE_PROBLEMS.estimateMissing);
  });
});

describe("issues the queue already holds", () => {
  it("is a 409 naming each offender", () => {
    const error = queueIssuesConflict([
      { issueId: ISSUE, code: QUEUE_ISSUE_PROBLEMS.alreadyQueued, issueNumber: 485 },
    ]);

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.envelope().code).toBe(QUEUE_ERRORS.conflict);
    expect(error.envelope().details).toEqual({
      issues: [{ issueId: ISSUE, code: "issue_already_queued", issueNumber: 485 }],
    });
  });

  it("keeps *already queued* apart from *two of these share a number*", () => {
    // `queue_items_organization_issue_key` refuses both, and they are different mistakes: one
    // is a row somebody queued earlier, the other is this selection asking for one number
    // twice across two repositories.
    expect(QUEUE_ISSUE_PROBLEMS.alreadyQueued).not.toBe(QUEUE_ISSUE_PROBLEMS.numberTaken);
  });
});
