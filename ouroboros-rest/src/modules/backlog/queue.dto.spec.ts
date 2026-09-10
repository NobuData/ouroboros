import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { document } from "../../openapi/specification";
import { WORKFLOW_TAGS } from "../estimation/estimation.context";
import { MAX_QUEUED_ISSUES, QueueSelectionBody } from "./queue.dto";

/**
 * What the pipe refuses before a statement is issued
 * (M.3, [#112](https://github.com/NobuData/ouroboros/issues/112)).
 *
 * The three properties this file exists to state:
 *
 *   * **A selection is ids, and they are `github_issues.id`.** A number where a uuid belongs is
 *     a `422` naming the field rather than a round trip that answers `404` — and it is also what
 *     stops arbitrary text reaching a `where` clause's parameter.
 *   * **The workflow is the fixed set K5 declares**, not opaque text. `queue_items.workflow_tag`
 *     is deliberately unconstrained (decision F8) so a renamed workflow still renders, which
 *     means the database will *not* catch a tag nothing runs; this is the only place that can.
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

  it("accepts every workflow the fixed set declares", () => {
    for (const workflow of WORKFLOW_TAGS) {
      expect(offenders({ issueIds: [ISSUE], workflow })).toEqual([]);
    }
  });

  it("refuses a workflow this installation has none of", () => {
    // Decision K5's set is closed here because `queue_items.workflow_tag` is open by decision
    // F8: a tag no workflow answers to would be a queue row nothing ever picks up.
    expect(offenders({ issueIds: [ISSUE], workflow: "midnight-loop" })).toEqual(["workflow"]);
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
      properties?: Record<string, { enum?: unknown[]; minItems?: number; maxItems?: number }>;
    };

  it("offers the same workflow tags this installation has", () => {
    // The document is the registry a client reads, and *Assign workflow ▾* is built from this
    // enum. A tag here that `WORKFLOW_TAGS` does not have would be an option a person can
    // choose and this service then refuses.
    expect(schema().properties?.workflow?.enum).toEqual([...WORKFLOW_TAGS]);
  });

  it("documents the same bounds the pipe enforces", () => {
    expect(schema().properties?.issueIds?.minItems).toBe(1);
    expect(schema().properties?.issueIds?.maxItems).toBe(MAX_QUEUED_ISSUES);
  });
});
