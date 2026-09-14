import { HttpStatus } from "@nestjs/common";

import type { WorkflowVersion } from "../db/schema";
import { UNIQUE_VIOLATION } from "../tenancy/constraints";
import { fromParseIssues } from "./code.diagnostics";
import { CONFIG_FILE_PATH, slugMismatch } from "./code.resources";
import { NO_DRAFT, draftEtag } from "./draft.etag";
import { validateWorkflowDocument } from "./dsl.validator";
import type { PublishFinding } from "./publish.gate";
import {
  WORKFLOW_CONSTRAINTS,
  WORKFLOW_ERRORS,
  codeInvalid,
  codeReadOnly,
  codeUnprojectable,
  conflictingDraft,
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
  workflowSlugNotFound,
} from "./workflows.errors";

/**
 * The codes and the statuses, held together.
 *
 * Every constructor is checked for the status it claims and the code it carries, because those
 * two strings are the whole of what a client branches on — and because `openapi.yaml` documents
 * them by name, which `openapi.spec.ts` then holds the service to.
 */

const WORKFLOW = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";
const EDITED = new Date("2026-09-12T10:05:00.000Z");

describe("the codes", () => {
  it("are the strings the specification publishes", () => {
    expect(WORKFLOW_ERRORS).toEqual({
      codeInvalid: "workflow_code_invalid",
      codeUnprojectable: "workflow_code_unprojectable",
      codeReadOnly: "workflow_code_read_only",
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

  it("answers 409 for a stale draft, carrying both etags, the editor and the stamp", () => {
    const error = draftConflict("stale-token", {
      etag: "current-token",
      editedIn: "visual",
      updatedAt: EDITED,
    });

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.getResponse()).toEqual({
      code: "workflow_draft_conflict",
      message: "This draft was changed in the visual editor. Reload it before saving again.",
      details: {
        expected: "stale-token",
        current: "current-token",
        editedIn: "visual",
        updatedAt: "2026-09-12T10:05:00.000Z",
      },
    });
  });

  it.each([
    ["code", "This draft was changed in the code editor. Reload it before saving again."],
    [null, "This draft was changed by someone else. Reload it before saving again."],
  ] as const)("names the %s editor, or nobody in particular", (editedIn, message) => {
    const envelope = draftConflict("stale", {
      etag: "now",
      editedIn,
      updatedAt: null,
    }).getResponse() as { message: string; details: Record<string, unknown> };

    expect(envelope.message).toBe(message);
    expect(envelope.details).toMatchObject({ editedIn, updatedAt: null });
  });

  it("reads a conflict from the draft row the guard locked, or from its absence", () => {
    const row: WorkflowVersion = {
      id: "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9",
      workflow_id: WORKFLOW,
      version: null,
      definition: {},
      published_at: null,
      published_by: null,
      change_note: null,
      edited_in: "code",
      created_at: EDITED,
      updated_at: EDITED,
    };

    expect(conflictingDraft(row)).toEqual({
      etag: draftEtag(row),
      editedIn: "code",
      updatedAt: EDITED,
    });
    expect(conflictingDraft(undefined)).toEqual({
      etag: NO_DRAFT,
      editedIn: null,
      updatedAt: null,
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

describe("the code view's refusals", () => {
  it("answers 404 for a slug, echoing it in place of an id", () => {
    const error = workflowSlugNotFound("standard-fix");

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.getResponse()).toMatchObject({
      code: "workflow_not_found",
      details: { slug: "standard-fix" },
    });
  });

  it("answers 422 for a file that does not read, carrying every anchored error", () => {
    const errors = [
      {
        code: "code_out_of_grammar" as const,
        message: 'The workflow\'s `dsl` is written as a string literal, like "text".',
        line: 4,
        column: 8,
        endLine: 4,
        endColumn: 11,
        hint: "Supported in the full SDK (v2)",
      },
      slugMismatch({ line: 3, column: 27, endLine: 3, endColumn: 41 }, "standard-fix", "docs-loop"),
    ];

    const error = codeInvalid(errors);

    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(error.getResponse()).toMatchObject({
      code: "workflow_code_invalid",
      details: { errors },
    });
    expect((error.getResponse() as { message: string }).message).toContain("draft is unchanged");
  });

  it("carries the same issues as the code view's diagnostics stream, in its order (W.2)", () => {
    const errors = [
      {
        code: "code_out_of_grammar" as const,
        message: "Out of grammar.",
        line: 4,
        column: 8,
        endLine: 4,
        endColumn: 11,
        hint: "Supported in the full SDK (v2)",
      },
      slugMismatch({ line: 3, column: 27, endLine: 3, endColumn: 41 }, "standard-fix", "docs-loop"),
    ];

    const { details } = codeInvalid(errors).getResponse() as {
      details: { diagnostics: unknown };
    };

    expect(details.diagnostics).toEqual(fromParseIssues(errors));
    expect(details.diagnostics).toEqual([
      expect.objectContaining({ severity: "error", code: "code_slug_mismatch" }),
      expect.objectContaining({
        severity: "error",
        code: "code_out_of_grammar",
        note: "Supported in the full SDK (v2)",
      }),
    ]);
  });

  it("answers 409 for a draft the code view cannot show, with the validator's findings", () => {
    const findings = validateWorkflowDocument({}).errors;

    const error = codeUnprojectable("standard-fix", null, findings);

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.getResponse()).toMatchObject({
      code: "workflow_code_unprojectable",
      message: "This draft cannot be shown as code yet. Finish it in the visual editor first.",
      details: { slug: "standard-fix", version: null, findings },
    });
  });

  it("says a published version cannot be shown, rather than asking anyone to finish it", () => {
    expect(codeUnprojectable("standard-fix", 14, []).getResponse()).toMatchObject({
      message: "This version cannot be shown as code.",
      details: { version: 14, findings: [] },
    });
  });

  it("answers 405 for a read-only file, naming it", () => {
    const error = codeReadOnly(CONFIG_FILE_PATH);

    expect(error.getStatus()).toBe(HttpStatus.METHOD_NOT_ALLOWED);
    expect(error.getResponse()).toMatchObject({
      code: "workflow_code_read_only",
      details: { path: "ouroboros.config.ts" },
    });
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
