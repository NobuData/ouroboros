import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { document } from "../../openapi/specification";
import { BOOTSTRAP_WORKFLOW_SLUGS } from "../workflows/registry.service";
import {
  MAX_QUEUED_ISSUES,
  MAX_WORKFLOW_SLUG_LENGTH,
  QueueSelectionBody,
  WORKFLOW_SLUG_PATTERN,
} from "./queue.dto";

/**
 * What the pipe refuses before a statement is issued
 * (M.3, [#112](https://github.com/NobuData/ouroboros/issues/112)).
 *
 * The three properties this file exists to state:
 *
 *   * **A selection is ids, and they are `github_issues.id`.** A number where a uuid belongs is
 *     a `422` naming the field rather than a round trip that answers `404` — and it is also what
 *     stops arbitrary text reaching a `where` clause's parameter.
 *   * **The workflow is checked for *shape* here and for existence by the service.** It was
 *     decision K5's closed set until P.4 ([#135](https://github.com/NobuData/ouroboros/issues/135))
 *     made the vocabulary this workspace's own workflows — which is a query, not a constant. So
 *     this layer refuses what could never name a row and `queue.service.spec.ts` holds the
 *     refusal that needs a workspace.
 *   * **An id sent twice is refused rather than de-duplicated.** A selection model that counted
 *     one row twice is already rendering a combined estimate that is wrong.
 */

const ISSUE = "5eed0018-0000-4000-8000-000000000485";
const OTHER = "5eed0018-0000-4000-8000-000000000484";

/**
 * Validate a body the way the pipe does.
 *
 * @param body - What a client sent.
 * @returns The property names that failed, so an assertion names a field rather than a message.
 */
function offenders(body: unknown): string[] {
  return validateSync(plainToInstance(QueueSelectionBody, body)).map((error) => error.property);
}

describe("the queue selection body", () => {
  it("accepts a selection of issue ids with no workflow", () => {
    // *Queue 3 selected ⟳* — each issue runs under its own suggested workflow.
    expect(offenders({ issueIds: [ISSUE, OTHER] })).toEqual([]);
  });

  it("accepts any slug, because the vocabulary is a workspace's rather than a constant", () => {
    // Every built-in still passes — which is the compatibility guarantee, since every tag V029
    // can hold is a slug — and so does a workflow only one workspace has. Whether *this*
    // workspace has it is `queue.service.ts`' question: `422 queue_workflow_unknown`.
    for (const workflow of [...BOOTSTRAP_WORKFLOW_SLUGS, "hotfix-p0", "release-train-2"]) {
      expect(offenders({ issueIds: [ISSUE], workflow })).toEqual([]);
    }
  });

  it("refuses a value that could never name a workflow", () => {
    // `workflows_slug_format`, mirrored: lower-case kebab, no leading, trailing or doubled
    // hyphen, nothing else. Refusing the shape from the pipe costs no connection, and a value
    // this rejects could not have matched a row.
    for (const workflow of ["Standard-Fix", "standard fix", "-standard", "standard-", "a--b", ""]) {
      expect(offenders({ issueIds: [ISSUE], workflow })).toEqual(["workflow"]);
    }
  });

  it("refuses a slug longer than the column would hold", () => {
    expect(
      offenders({ issueIds: [ISSUE], workflow: "a".repeat(MAX_WORKFLOW_SLUG_LENGTH + 1) }),
    ).toEqual(["workflow"]);
    expect(
      offenders({ issueIds: [ISSUE], workflow: "a".repeat(MAX_WORKFLOW_SLUG_LENGTH) }),
    ).toEqual([]);
  });

  it("mirrors the bounds V029 puts on a slug", () => {
    // The same expression and the same length `workflows.slug` is CHECKed with, so the two
    // cannot drift into a value this accepts and the database refuses.
    expect(WORKFLOW_SLUG_PATTERN.source).toBe("^[a-z0-9]+(-[a-z0-9]+)*$");
    expect(MAX_WORKFLOW_SLUG_LENGTH).toBe(64);
  });

  it("refuses an id that could not name a row", () => {
    expect(offenders({ issueIds: ["485"] })).toEqual(["issueIds"]);
  });

  it("refuses a selection of nothing", () => {
    // Answering `201 {items: []}` would let a broken client believe it had queued something.
    expect(offenders({ issueIds: [] })).toEqual(["issueIds"]);
  });

  it("refuses the same issue twice rather than quietly de-duplicating it", () => {
    expect(offenders({ issueIds: [ISSUE, ISSUE] })).toEqual(["issueIds"]);
  });

  it("refuses a selection larger than a page of the table", () => {
    const tooMany = Array.from(
      { length: MAX_QUEUED_ISSUES + 1 },
      (_unused, index) => `5eed0018-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );

    expect(offenders({ issueIds: tooMany })).toEqual(["issueIds"]);
  });

  it("caps a selection at the listing's own page size", () => {
    // Not a product rule: the batch is one transaction, and a transaction whose size a client
    // chooses is a lock somebody else waits behind. A hundred is every row the table can show.
    expect(MAX_QUEUED_ISSUES).toBe(100);
  });
});

describe("the body and the document", () => {
  /** The request schema, as `openapi.yaml` declares it. */
  const schema = () =>
    (document().components?.schemas?.QueueSelection ?? {}) as {
      properties?: Record<
        string,
        {
          enum?: unknown[];
          pattern?: string;
          maxLength?: number;
          minItems?: number;
          maxItems?: number;
        }
      >;
    };

  it("publishes the slug's shape rather than a list of four names", () => {
    // The enum was right while the vocabulary was a constant every installation shared. It is
    // now per workspace, so a document enumerating four would be publishing a list that is
    // wrong for every workspace with workflows of its own — see `queue.dto.ts` on the trade.
    expect(schema().properties?.workflow?.enum).toBeUndefined();
    expect(schema().properties?.workflow?.pattern).toBe(WORKFLOW_SLUG_PATTERN.source);
    expect(schema().properties?.workflow?.maxLength).toBe(MAX_WORKFLOW_SLUG_LENGTH);
  });

  it("documents the same bounds the pipe enforces", () => {
    expect(schema().properties?.issueIds?.minItems).toBe(1);
    expect(schema().properties?.issueIds?.maxItems).toBe(MAX_QUEUED_ISSUES);
  });
});
