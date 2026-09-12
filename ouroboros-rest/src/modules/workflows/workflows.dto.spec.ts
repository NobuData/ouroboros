import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { WORKFLOW_STATUSES } from "../db/schema";
import { CHANGE_NOTE_MAX_LENGTH, NAME_MAX_LENGTH, SLUG_MAX_LENGTH } from "./slug";
import {
  CreateWorkflowBody,
  PublishWorkflowBody,
  ReadWorkflowQuery,
  SaveDraftBody,
  UpdateWorkflowBody,
  WorkflowParams,
} from "./workflows.dto";

/**
 * The request shapes, validated the way the pipe validates them — through
 * `class-transformer`, so the strings a query string actually carries are what the decorators
 * judge.
 *
 * Every bound here restates a V029 constraint, and the point of the pairing is that a `422`
 * naming the field arrives before a connection is taken from the pool.
 */

/** Validate one body or query the way the pipe would, returning the failing property names. */
async function violations<T extends object>(
  type: new () => T,
  value: Record<string, unknown>,
): Promise<string[]> {
  const failures = await validate(plainToInstance(type, value));

  return failures.map((failure) => failure.property);
}

describe("the path", () => {
  it("admits a uuid and refuses anything else, naming the field", async () => {
    expect(
      await violations(WorkflowParams, { id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94" }),
    ).toEqual([]);
    expect(await violations(WorkflowParams, { id: "standard-fix" })).toEqual(["id"]);
  });
});

describe("the detail's query", () => {
  it("admits no version at all — the ordinary read of what is in force", async () => {
    expect(await violations(ReadWorkflowQuery, {})).toEqual([]);
  });

  it("transforms the query string's digits into the integer the handler reads", async () => {
    const query = plainToInstance(ReadWorkflowQuery, { version: "14" });

    expect(await validate(query)).toEqual([]);
    expect(query.version).toBe(14);
  });

  it.each([
    ["a word", "latest"],
    ["a fraction", "1.5"],
    ["zero, which no version has", "0"],
    ["a negative number", "-3"],
  ])("refuses %s", async (_name, version) => {
    expect(await violations(ReadWorkflowQuery, { version })).toEqual(["version"]);
  });
});

describe("the create body", () => {
  it("needs only a title", async () => {
    expect(await violations(CreateWorkflowBody, { name: "Standard Fix" })).toEqual([]);
  });

  it.each([
    ["a blank title", ""],
    ["a title past `workflows_name_present`", "a".repeat(NAME_MAX_LENGTH + 1)],
  ])("refuses %s", async (_name, value) => {
    expect(await violations(CreateWorkflowBody, { name: value })).toEqual(["name"]);
  });

  it("admits a slug the caller chose, and refuses one the database would", async () => {
    expect(
      await violations(CreateWorkflowBody, { name: "Standard Fix", slug: "standard-fix" }),
    ).toEqual([]);

    for (const slug of [
      "Standard-Fix",
      "standard_fix",
      "-standard",
      "standard-",
      "a".repeat(SLUG_MAX_LENGTH + 1),
    ]) {
      expect(await violations(CreateWorkflowBody, { name: "Standard Fix", slug })).toEqual([
        "slug",
      ]);
    }
  });

  it("admits a template stub as a document, and refuses one that is not an object", async () => {
    // `workflow_versions_definition_object`, restated. What is *inside* it is P.2's question,
    // asked at publish.
    expect(
      await violations(CreateWorkflowBody, { name: "From template", definition: { nodes: [] } }),
    ).toEqual([]);
    expect(await violations(CreateWorkflowBody, { name: "x", definition: "{}" })).toEqual([
      "definition",
    ]);
    expect(await violations(CreateWorkflowBody, { name: "x", definition: [] })).toEqual([
      "definition",
    ]);
  });
});

describe("the update body", () => {
  it("admits a body with neither field, which asks for nothing", async () => {
    // `forbidNonWhitelisted` already refuses a mistyped field, so `{}` is a request that
    // genuinely asks for nothing — and the service answers it with the workflow as it stands.
    expect(await violations(UpdateWorkflowBody, {})).toEqual([]);
  });

  it.each([...WORKFLOW_STATUSES])("admits the status %s", async (status) => {
    expect(await violations(UpdateWorkflowBody, { status })).toEqual([]);
  });

  it("refuses a status nobody defined", async () => {
    expect(await violations(UpdateWorkflowBody, { status: "retired" })).toEqual(["status"]);
  });

  it("declares no slug, because renaming one would re-point every closed run", () => {
    // The slug is the bridge a stored `workflow_tag` resolves through (V029).
    expect(new UpdateWorkflowBody()).not.toHaveProperty("slug");
  });
});

describe("the draft body", () => {
  it("requires a document, and takes it whole", async () => {
    expect(await violations(SaveDraftBody, { definition: { nodes: [] } })).toEqual([]);
    expect(await violations(SaveDraftBody, {})).toEqual(["definition"]);
  });

  it("admits the empty canvas, which V029 calls a legal stored state", async () => {
    expect(await violations(SaveDraftBody, { definition: {} })).toEqual([]);
  });

  it("admits a half-built canvas, because a validating autosave is an autosave nobody can use", async () => {
    expect(
      await violations(SaveDraftBody, { definition: { dsl_version: "1.0", nodes: [{}] } }),
    ).toEqual([]);
  });
});

describe("the publish body", () => {
  it("admits a publish with nothing to say", async () => {
    expect(await violations(PublishWorkflowBody, {})).toEqual([]);
  });

  it.each([
    ["a blank note, which is one that lost its text", ""],
    ["a note past `workflow_versions_change_note_present`", "a".repeat(CHANGE_NOTE_MAX_LENGTH + 1)],
  ])("refuses %s", async (_name, changeNote) => {
    expect(await violations(PublishWorkflowBody, { changeNote })).toEqual(["changeNote"]);
  });

  it("admits a note at the bound", async () => {
    expect(
      await violations(PublishWorkflowBody, { changeNote: "a".repeat(CHANGE_NOTE_MAX_LENGTH) }),
    ).toEqual([]);
  });
});
