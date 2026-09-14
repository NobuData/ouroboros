import type { Organization, Workflow, WorkflowVersion } from "../db/schema";
import type { WorkflowCatalogService } from "./catalog.service";
import { edit, golden } from "./code.parser.fixture";
import * as projection from "./code.projection";
import { WorkflowCodeService } from "./code.service";
import { NO_DRAFT, draftEtag } from "./draft.etag";
import { readFixture } from "./dsl.golden.fixture";
import type { WorkflowStatsRepository } from "./stats.repository";
import { draftConflict } from "./workflows.errors";
import type { WorkflowsRepository } from "./workflows.repository";
import type { WorkflowsService } from "./workflows.service";

/**
 * The code view's rules — U.3 ([#167](https://github.com/NobuData/ouroboros/issues/167)) and W.2
 * ([#178](https://github.com/NobuData/ouroboros/issues/178)).
 *
 * The statements are the repositories' suites, the guard is `workflows.service.spec.ts`', the
 * diagnostics and rows are `code.diagnostics.spec.ts`' and `code.checks.spec.ts`', and the whole
 * pipeline is `code.integration-spec.ts`'. What only this suite can hold is the order of the
 * decisions a save makes, and two of them are acceptance criteria: **a file that does not read
 * never reaches the guarded write**, and **the draft's etag is the one both editors share**. It also
 * holds that every file carries its span map and diagnostics, checked against the workspace's own
 * names, and that the checks read opens exactly the file the read does.
 */

const WORKSPACE = "acme-robotics-id";
const WORKFLOW = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";
const AT = new Date("2026-09-12T10:00:00.000Z");
const LATER = new Date("2026-09-12T10:05:00.000Z");

/** The minimal fixture's document, and the file its projection is committed as. */
const MINIMAL = readFixture("valid/minimal.json");
const MINIMAL_FILE = golden("minimal");

/** The minimal file's span map: its trigger stage, then its terminal. */
const MINIMAL_SPANS = [
  { node: "start", startLine: 9, endLine: 12 },
  { node: "done", startLine: 13, endLine: 15 },
];

/** A workflow row named `minimal`, so the committed projection is its file. */
function workflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: WORKFLOW,
    organization_id: WORKSPACE,
    slug: "minimal",
    name: "Minimal",
    status: "active",
    current_version: 3,
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

/** A draft row holding the minimal document. */
function draft(overrides: Partial<WorkflowVersion> = {}): WorkflowVersion {
  return {
    id: "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9",
    workflow_id: WORKFLOW,
    version: null,
    definition: MINIMAL,
    published_at: null,
    published_by: null,
    change_note: null,
    edited_in: "visual",
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

/** A published version of the minimal document. */
function published(version: number): WorkflowVersion {
  return draft({
    id: `9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c0${version}`,
    version,
    published_at: AT,
    edited_in: null,
  });
}

/** The minimal document with a terminal nothing reaches — a draft that still prints. */
function withOrphan(): unknown {
  // Copied through JSON rather than `structuredClone`: under Jest the clone's objects come from
  // another realm's `Object.prototype`, and the projection's `isDeepStrictEqual` compares
  // prototypes, so the round trip would refuse a document that is really the same.
  const document = JSON.parse(JSON.stringify(MINIMAL)) as { nodes: unknown[] };
  document.nodes.push({
    id: "orphan",
    type: "term",
    title: "Nothing reaches this",
    position: { x: 480, y: 0 },
    config: { action: "needs_review", options: {} },
  });
  return document;
}

/** The workspace, as the tenant guard establishes it. */
const TENANT: Organization = {
  id: WORKSPACE,
  name: "Acme Robotics",
  slug: "acme-robotics",
  logo: null,
  createdAt: AT,
  metadata: null,
};

/** Everything the service is constructed from, each a spy. */
interface Harness {
  service: WorkflowCodeService;
  workflows: jest.Mocked<WorkflowsRepository>;
  registry: jest.Mocked<WorkflowStatsRepository>;
  lifecycle: jest.Mocked<WorkflowsService>;
  catalog: jest.Mocked<Pick<WorkflowCatalogService, "dslCatalogue">>;
}

/**
 * A service over spies: a workspace with the `minimal` workflow, its draft and its versions.
 *
 * @returns The harness. The guarded write answers with the draft it would have stored, and the
 *   workspace's routing matrix has one task kind.
 */
function harness(): Harness {
  const workflows = {
    findBySlug: jest.fn().mockResolvedValue(workflow()),
    draftOf: jest.fn().mockResolvedValue(draft()),
    versionAt: jest
      .fn()
      .mockImplementation((_id: string, version: number) => Promise.resolve(published(version))),
  } as unknown as jest.Mocked<WorkflowsRepository>;

  const registry = {
    registryEntries: jest.fn().mockResolvedValue([
      {
        id: WORKFLOW,
        slug: "minimal",
        name: "Minimal",
        status: "paused",
        current_version: 3,
        stage_count: 2,
        terminal_actions: ["needs_review"],
      },
    ]),
  } as unknown as jest.Mocked<WorkflowStatsRepository>;

  const lifecycle = {
    writeGuarded: jest
      .fn()
      .mockImplementation((_workflow: Workflow, _ifMatch: string, definition: unknown) =>
        Promise.resolve(draft({ definition, edited_in: "code", updated_at: LATER })),
      ),
  } as unknown as jest.Mocked<WorkflowsService>;

  const catalog = { dslCatalogue: jest.fn().mockResolvedValue({ tasks: ["implement"] }) };

  return {
    service: new WorkflowCodeService(
      workflows,
      registry,
      lifecycle,
      catalog as unknown as WorkflowCatalogService,
    ),
    workflows,
    registry,
    lifecycle,
    catalog,
  };
}

/**
 * The envelope a call refuses with.
 *
 * @param call - The promise that must reject.
 * @returns The envelope, so an assertion can read its code and details.
 */
async function refusal(
  call: Promise<unknown>,
): Promise<{ code: string; details: Record<string, unknown> }> {
  return call.then(
    () => {
      throw new Error("expected this call to be refused, and it resolved");
    },
    (error: unknown) =>
      (
        error as { getResponse(): { code: string; details: Record<string, unknown> } }
      ).getResponse(),
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("reading a workflow as a file", () => {
  it("is the draft's projection, carrying the draft's etag, span map and checks reference", async () => {
    const { service, workflows } = harness();

    const file = await service.read(WORKSPACE, "minimal");

    expect(workflows.findBySlug).toHaveBeenCalledWith(WORKSPACE, "minimal");
    expect(file).toEqual({
      path: "workflows/minimal.loop.ts",
      slug: "minimal",
      text: MINIMAL_FILE,
      etag: draftEtag(draft()),
      readOnly: false,
      version: null,
      currentVersion: 3,
      spans: MINIMAL_SPANS,
      diagnostics: [],
      outlineRef: null,
      checksRef: "/api/v1/workflows/minimal/code/checks",
    });
  });

  it("carries the draft's findings on the lines of the stage each is about", async () => {
    const { service, workflows } = harness();
    workflows.draftOf.mockResolvedValue(draft({ definition: withOrphan() }));

    const file = await service.read(WORKSPACE, "minimal");

    expect(file.diagnostics).toEqual([
      expect.objectContaining({ severity: "error", code: "node.unreachable", node: "orphan" }),
    ]);
    expect(file.diagnostics[0].range.line).toBe(file.spans[2].startLine);
  });

  it("checks references against this workspace's names", async () => {
    const { service, catalog } = harness();

    await service.read(WORKSPACE, "minimal");

    expect(catalog.dslCatalogue).toHaveBeenCalledWith(WORKSPACE);
  });

  it("opens on the version in force when there is no draft, editable, as the canvas does", async () => {
    const { service, workflows } = harness();
    workflows.draftOf.mockResolvedValue(undefined);

    const file = await service.read(WORKSPACE, "minimal");

    expect(workflows.versionAt).toHaveBeenCalledWith(WORKFLOW, 3);
    expect(file).toMatchObject({
      text: MINIMAL_FILE,
      etag: NO_DRAFT,
      version: 3,
      readOnly: false,
      checksRef: "/api/v1/workflows/minimal/code/checks",
    });
  });

  it("reads a published version read-only when one is named, with the draft's etag", async () => {
    const { service, workflows } = harness();

    const file = await service.read(WORKSPACE, "minimal", 2);

    expect(workflows.versionAt).toHaveBeenCalledWith(WORKFLOW, 2);
    expect(file).toMatchObject({
      version: 2,
      readOnly: true,
      etag: draftEtag(draft()),
      checksRef: "/api/v1/workflows/minimal/code/checks?version=2",
    });
  });

  it("answers 404 for a slug this workspace does not have, echoing the slug", async () => {
    const { service, workflows, catalog } = harness();
    workflows.findBySlug.mockResolvedValue(undefined);

    expect(await refusal(service.read(WORKSPACE, "standard-fix"))).toMatchObject({
      code: "workflow_not_found",
      details: { slug: "standard-fix" },
    });
    expect(workflows.draftOf).not.toHaveBeenCalled();
    expect(catalog.dslCatalogue).not.toHaveBeenCalled();
  });

  it("answers 404 for a version number the workflow does not have", async () => {
    const { service, workflows } = harness();
    workflows.versionAt.mockResolvedValue(undefined);

    expect((await refusal(service.read(WORKSPACE, "minimal", 9))).code).toBe(
      "workflow_version_not_found",
    );
  });

  it("refuses a draft it cannot show without changing it, with the validator's findings", async () => {
    const { service, workflows, catalog } = harness();
    workflows.draftOf.mockResolvedValue(draft({ definition: {} }));

    const envelope = await refusal(service.read(WORKSPACE, "minimal"));

    expect(envelope.code).toBe("workflow_code_unprojectable");
    expect(envelope.details).toMatchObject({ slug: "minimal", version: null });
    expect(envelope.details.findings).not.toEqual([]);
    expect(catalog.dslCatalogue).not.toHaveBeenCalled();
  });

  it("refuses a workflow with nothing to show at all — no draft and nothing in force", async () => {
    const { service, workflows } = harness();
    workflows.findBySlug.mockResolvedValue(workflow({ current_version: null }));
    workflows.draftOf.mockResolvedValue(undefined);

    expect(await refusal(service.read(WORKSPACE, "minimal"))).toMatchObject({
      code: "workflow_code_unprojectable",
      details: { findings: [] },
    });
    expect(workflows.versionAt).not.toHaveBeenCalled();
  });
});

describe("a file's Loop Checks", () => {
  it("are the rows for the file the read opens, with its path, version and the draft's etag", async () => {
    const { service } = harness();

    expect(await service.checks(WORKSPACE, "minimal")).toEqual({
      path: "workflows/minimal.loop.ts",
      slug: "minimal",
      etag: draftEtag(draft()),
      readOnly: false,
      version: null,
      rows: [
        { id: "graph", status: "ok", title: "Graph acyclic" },
        { id: "references", status: "ok", title: "All task routes resolve" },
      ],
    });
  });

  it("leave out the references row when the workspace has no routing matrix", async () => {
    const { service, catalog } = harness();
    catalog.dslCatalogue.mockResolvedValue({});

    expect((await service.checks(WORKSPACE, "minimal")).rows).toEqual([
      { id: "graph", status: "ok", title: "Graph acyclic" },
    ]);
  });

  it("report the draft's errors, and nothing about references they stopped", async () => {
    const { service, workflows } = harness();
    workflows.draftOf.mockResolvedValue(draft({ definition: withOrphan() }));

    expect((await service.checks(WORKSPACE, "minimal")).rows).toEqual([
      {
        id: "graph",
        status: "err",
        title: "1 validation error",
        note: "No path of edges reaches this stage from the trigger.",
      },
    ]);
  });

  it("check a published version when one is named", async () => {
    const { service, workflows } = harness();

    const checks = await service.checks(WORKSPACE, "minimal", 2);

    expect(workflows.versionAt).toHaveBeenCalledWith(WORKFLOW, 2);
    expect(checks).toMatchObject({ version: 2, readOnly: true });
  });

  it("answer as the read does for a slug the workspace lacks or a draft it cannot show", async () => {
    const { service, workflows } = harness();
    workflows.findBySlug.mockResolvedValueOnce(undefined);

    expect((await refusal(service.checks(WORKSPACE, "standard-fix"))).code).toBe(
      "workflow_not_found",
    );

    workflows.draftOf.mockResolvedValue(draft({ definition: {} }));

    expect((await refusal(service.checks(WORKSPACE, "minimal"))).code).toBe(
      "workflow_code_unprojectable",
    );
  });
});

describe("saving a file", () => {
  /** The minimal file with its terminal stage retitled — a real edit. */
  const RETITLED = edit(MINIMAL_FILE, 'title: "Needs review"', 'title: "Needs a human"');

  it("writes the document the file spells through the shared guard, as the code editor", async () => {
    const { service, lifecycle } = harness();
    const etag = draftEtag(draft());

    const saved = await service.save(WORKSPACE, "minimal", etag, RETITLED);

    const [written, ifMatch, definition, editor] = lifecycle.writeGuarded.mock.calls[0];
    expect(written).toEqual(workflow());
    expect(ifMatch).toBe(etag);
    expect(editor).toBe("code");
    expect((definition as { nodes: { title: string }[] }).nodes[1].title).toBe("Needs a human");
    expect(saved).toMatchObject({
      text: RETITLED,
      readOnly: false,
      version: null,
      spans: MINIMAL_SPANS,
      diagnostics: [],
      checksRef: "/api/v1/workflows/minimal/code/checks",
    });
    expect(saved.etag).toBe(draftEtag(draft({ definition, edited_in: "code", updated_at: LATER })));
  });

  it("answers with the saved document's findings, which a save does not refuse", async () => {
    const { service } = harness();
    const orphaned = edit(
      MINIMAL_FILE,
      "  ],\n",
      '    needsReview("orphan", {\n      title: "Nothing reaches this",\n    }),\n  ],\n',
    ).replace("// edge start done", "// node orphan 480 0\n// edge start done");

    const saved = await service.save(WORKSPACE, "minimal", "*", orphaned);

    expect(saved.diagnostics).toEqual([
      expect.objectContaining({ severity: "error", code: "node.unreachable", node: "orphan" }),
    ]);
  });

  it("answers with the canonical file, whatever spelling of the same document it was sent", async () => {
    const { service } = harness();
    const respelled = edit(MINIMAL_FILE, 'dsl: "1.0",', "dsl:   '1.0',");

    const saved = await service.save(WORKSPACE, "minimal", "*", respelled);

    expect(saved.text).toBe(MINIMAL_FILE);
  });

  it("refuses a file that does not read with anchored errors, and never reaches the write", async () => {
    const { service, lifecycle } = harness();
    const typo = edit(MINIMAL_FILE, 'dsl: "1.0",', "dsl: 1.0,");

    const envelope = await refusal(service.save(WORKSPACE, "minimal", "*", typo));

    expect(envelope.code).toBe("workflow_code_invalid");
    expect(envelope.details.errors).toEqual([
      expect.objectContaining({ code: "code_out_of_grammar", line: 4, column: 8 }),
    ]);
    expect(envelope.details.diagnostics).toEqual([
      expect.objectContaining({
        severity: "error",
        code: "code_out_of_grammar",
        range: { line: 4, column: 8, endLine: 4, endColumn: 11 },
      }),
    ]);
    expect(lifecycle.writeGuarded).not.toHaveBeenCalled();
  });

  it("refuses a file that names another workflow, anchored at its slug", async () => {
    const { service, lifecycle } = harness();
    const renamed = edit(MINIMAL_FILE, 'defineLoop("minimal"', 'defineLoop("standard-fix"');

    const envelope = await refusal(service.save(WORKSPACE, "minimal", "*", renamed));

    expect(envelope.code).toBe("workflow_code_invalid");
    expect(envelope.details.errors).toEqual([
      expect.objectContaining({
        code: "code_slug_mismatch",
        line: 3,
        column: 27,
        endLine: 3,
        endColumn: 41,
      }),
    ]);
    expect(envelope.details.diagnostics).toEqual([
      expect.objectContaining({ severity: "error", code: "code_slug_mismatch" }),
    ]);
    expect(lifecycle.writeGuarded).not.toHaveBeenCalled();
  });

  it("refuses a save with no If-Match before reading the file, because it is a different mistake", async () => {
    const { service, lifecycle } = harness();

    expect((await refusal(service.save(WORKSPACE, "minimal", undefined, "not code"))).code).toBe(
      "workflow_draft_etag_required",
    );
    expect(lifecycle.writeGuarded).not.toHaveBeenCalled();
  });

  it("answers 404 before it asks about etags or reads the file", async () => {
    const { service, workflows, lifecycle } = harness();
    workflows.findBySlug.mockResolvedValue(undefined);

    expect((await refusal(service.save(WORKSPACE, "minimal", undefined, "not code"))).code).toBe(
      "workflow_not_found",
    );
    expect(lifecycle.writeGuarded).not.toHaveBeenCalled();
  });

  it("passes the guard's 409 through, naming the editor that changed the draft", async () => {
    const { service, lifecycle } = harness();
    lifecycle.writeGuarded.mockRejectedValue(
      draftConflict("stale", { etag: "current", editedIn: "visual", updatedAt: LATER }),
    );

    expect(await refusal(service.save(WORKSPACE, "minimal", "stale", MINIMAL_FILE))).toMatchObject({
      code: "workflow_draft_conflict",
      details: { editedIn: "visual" },
    });
  });

  it("writes nothing when the parser reads a document the printer cannot give back", async () => {
    const { service, lifecycle } = harness();
    jest.spyOn(projection, "projectWorkflowCode").mockReturnValue(undefined);

    await expect(service.save(WORKSPACE, "minimal", "*", MINIMAL_FILE)).rejects.toThrow(
      /cannot give back/,
    );
    expect(lifecycle.writeGuarded).not.toHaveBeenCalled();
  });

  it("writes nothing when the workspace's names cannot be read, because it diagnoses first", async () => {
    const { service, lifecycle, catalog } = harness();
    catalog.dslCatalogue.mockRejectedValue(new Error("the database is unavailable"));

    await expect(service.save(WORKSPACE, "minimal", "*", MINIMAL_FILE)).rejects.toThrow(
      /unavailable/,
    );
    expect(lifecycle.writeGuarded).not.toHaveBeenCalled();
  });
});

describe("the explorer and the configuration", () => {
  it("lists the rail's workflows, from the rail's own statement", async () => {
    const { service, registry } = harness();

    const tree = await service.tree(WORKSPACE);

    expect(registry.registryEntries).toHaveBeenCalledWith(WORKSPACE);
    expect(tree.files).toEqual([
      {
        path: "workflows/minimal.loop.ts",
        kind: "workflow",
        readOnly: false,
        slug: "minimal",
        status: "paused",
      },
      { path: "ouroboros.config.ts", kind: "config", readOnly: true, slug: null, status: null },
    ]);
  });

  it("prints the configuration for the tenant's workspace, read-only", async () => {
    const { service, registry } = harness();

    const config = await service.config(TENANT);

    expect(registry.registryEntries).toHaveBeenCalledWith(WORKSPACE);
    expect(config.readOnly).toBe(true);
    expect(config.text).toContain('workspace: "acme-robotics"');
    expect(config.text).toContain(
      '{ slug: "minimal", name: "Minimal", status: "paused", version: 3 },',
    );
  });
});
