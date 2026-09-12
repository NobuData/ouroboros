import { HttpStatus } from "@nestjs/common";

import { UNIQUE_VIOLATION } from "../tenancy/constraints";
import type { PublishFinding } from "./publish.gate";
import {
  WORKFLOW_CONSTRAINTS,
  WORKFLOW_ERRORS,
  definitionInvalid,
  draftAbsent,
  draftConflict,
  draftEtagRequired,
  publishConflict,
  slugRequired,
  slugTaken,
  versionNotFound,
  violates,
  workflowNotFound,
} from "./workflows.errors";

/**
 * The codes and the statuses, held together.
 *
 * Every constructor is checked for the status it claims and the code it carries, because those
 * two strings are the whole of what a client branches on — and because `openapi.yaml` documents
 * them by name, which `openapi.spec.ts` then holds the service to.
 */

const WORKFLOW = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";

describe("the codes", () => {
  it("are the strings the specification publishes", () => {
    expect(WORKFLOW_ERRORS).toEqual({
      workflowNotFound: "workflow_not_found",
      slugTaken: "workflow_slug_taken",
      versionNotFound: "workflow_version_not_found",
      draftEtagRequired: "workflow_draft_etag_required",
      draftConflict: "workflow_draft_conflict",
      draftAbsent: "workflow_draft_absent",
      slugRequired: "workflow_slug_required",
      definitionInvalid: "workflow_definition_invalid",
      publishConflict: "workflow_publish_conflict",
    });
  });

  it("names the V029 constraints it translates, spelled as the migration spells them", () => {
    // Greppable from the SQL. A renamed constraint then stops matching — a failing lookup —
    // rather than silently changing an answer.
    expect(Object.values(WORKFLOW_CONSTRAINTS)).toEqual([
      "workflows_organization_slug_key",
      "workflow_versions_one_draft_idx",
      "workflow_versions_workflow_version_key",
      "workflow_versions_next_version",
    ]);
  });
});

describe("the absences", () => {
  it("answers 404 for a workflow, echoing the id the caller sent", () => {
    const error = workflowNotFound(WORKFLOW);

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.getResponse()).toMatchObject({
      code: "workflow_not_found",
      details: { workflowId: WORKFLOW },
    });
  });

  it("answers 404 for a version, naming which number was asked for", () => {
    const error = versionNotFound(WORKFLOW, 14);

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.getResponse()).toMatchObject({
      code: "workflow_version_not_found",
      details: { workflowId: WORKFLOW, version: 14 },
    });
  });

  it("says nothing about tables or columns", () => {
    // The message is written for a person, per `runs.errors.ts`' contract.
    for (const error of [workflowNotFound(WORKFLOW), versionNotFound(WORKFLOW, 2)]) {
      const { message } = error.getResponse() as { message: string };

      expect(message).not.toMatch(/workflow_versions|organization_id|select/i);
    }
  });
});

describe("the conflicts", () => {
  it("answers 409 for a slug already in use, naming it", () => {
    const error = slugTaken("standard-fix");

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.getResponse()).toMatchObject({
      code: "workflow_slug_taken",
      details: { slug: "standard-fix" },
    });
  });

  it("answers 409 for a stale draft, carrying both etags", () => {
    const error = draftConflict("stale-token", "current-token");

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.getResponse()).toMatchObject({
      code: "workflow_draft_conflict",
      details: { expected: "stale-token", current: "current-token" },
    });
  });

  it("omits the current etag when it genuinely is not known", () => {
    // A draft created concurrently is reported by a unique index inside a transaction that
    // cannot then be read from. Inventing a token there would put a value in the envelope that
    // matches nothing.
    expect(draftConflict("none").getResponse()).toMatchObject({
      details: { expected: "none" },
    });
    expect((draftConflict("none").getResponse() as { details: object }).details).not.toHaveProperty(
      "current",
    );
  });

  it("answers 409 when there is no draft to publish", () => {
    const error = draftAbsent(WORKFLOW);

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.getResponse()).toMatchObject({ code: "workflow_draft_absent" });
  });

  it("answers 409 when two publishes raced", () => {
    const error = publishConflict(WORKFLOW);

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.getResponse()).toMatchObject({ code: "workflow_publish_conflict" });
  });
});

describe("the refusals a caller can fix", () => {
  it("answers 400 for a draft write with no If-Match", () => {
    // A 400 rather than a 422: nothing about the body is wrong and there is no field to name.
    const error = draftEtagRequired();

    expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(error.getResponse()).toMatchObject({ code: "workflow_draft_etag_required" });
  });

  it("answers 422 for a name no slug can be derived from", () => {
    const error = slugRequired("***");

    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(error.getResponse()).toMatchObject({
      code: "workflow_slug_required",
      details: { name: "***" },
    });
  });

  it("answers 422 for a definition the gate refused, carrying the findings verbatim", () => {
    const findings: PublishFinding[] = [
      {
        source: "dsl",
        code: "structure.no_trigger",
        message: "A workflow needs exactly one trigger node.",
        path: "/nodes",
      },
      {
        source: "engine",
        code: "unreachable_node",
        message: "Nothing reaches this node.",
        node: "review",
      },
    ];

    const error = definitionInvalid(findings);

    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(error.getResponse()).toMatchObject({
      code: "workflow_definition_invalid",
      details: { findings },
    });
  });

  it("keeps the node anchor a studio selects from", () => {
    // The acceptance criterion: a finding a person clicks has to say which node it is about.
    const { details } = definitionInvalid([
      { source: "engine", code: "gate_without_requirement", message: "…", node: "gate-1" },
    ]).getResponse() as { details: { findings: PublishFinding[] } };

    expect(details.findings[0].node).toBe("gate-1");
  });
});

describe("violates", () => {
  it("recognises the constraint the driver reported", () => {
    const failure = { code: UNIQUE_VIOLATION, constraint: WORKFLOW_CONSTRAINTS.slugUnique };

    expect(violates(failure, WORKFLOW_CONSTRAINTS.slugUnique)).toBe(true);
    expect(violates(failure, WORKFLOW_CONSTRAINTS.oneDraft)).toBe(false);
  });

  it("ignores the SQLSTATE, because V029 uses two of them for one kind of race", () => {
    // The dense-numbering rule is a trigger raising `check_violation`; the uniqueness rule is
    // an index raising `unique_violation`. Both mean *somebody published while you were*.
    expect(
      violates(
        { code: "23514", constraint: WORKFLOW_CONSTRAINTS.versionDense },
        "workflow_versions_next_version",
      ),
    ).toBe(true);
  });

  it.each([
    ["a rejection that is not a database failure", new Error("socket hang up")],
    ["a failure with no constraint", { code: UNIQUE_VIOLATION }],
    ["undefined", undefined],
  ])("answers false for %s", (_name, error) => {
    expect(violates(error, WORKFLOW_CONSTRAINTS.slugUnique)).toBe(false);
  });
});
