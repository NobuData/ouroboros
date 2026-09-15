import type { Workflow, WorkflowVersion } from "../db/schema";
import type { EngineClient } from "../engine/engine.client";
import type { EngineWorkflowDryRun } from "../engine/engine.contract";
import type { WorkflowDryRunRepository } from "./dry-run.repository";
import { WorkflowDryRunService } from "./dry-run.service";
import type { WorkflowsRepository } from "./workflows.repository";

/**
 * The dry run's decisions — which document is walked, which ticket it is walked for, and the
 * `404`s that cover *not this workspace's*.
 *
 * The statement is `dry-run.repository.spec.ts`', the wire is `engine.client.spec.ts`', and the
 * whole leg over a socket is `studio.integration-spec.ts`'. What only this suite holds is the order
 * of the refusals and the choice of document.
 */

const WORKSPACE = "acme-robotics-id";
const WORKFLOW = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";
const ISSUE = "7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const AT = new Date("2026-09-12T10:00:00.000Z");

const DRAFTED = { dsl_version: "1.0", nodes: [{ id: "drafted" }] };
const PUBLISHED = { dsl_version: "1.0", nodes: [{ id: "published" }] };

/** A workflow row, with whatever a test changes. */
function workflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: WORKFLOW,
    organization_id: WORKSPACE,
    slug: "standard-fix",
    name: "standard-fix",
    status: "active",
    current_version: 14,
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

/** A version row — a draft when `version` is null. */
function row(definition: unknown, version: number | null): WorkflowVersion {
  return {
    id: "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9",
    workflow_id: WORKFLOW,
    version,
    definition,
    published_at: null,
    published_by: null,
    change_note: null,
    edited_in: null,
    created_at: AT,
    updated_at: AT,
  };
}

/** The walk the engine answers with. */
const WALK: EngineWorkflowDryRun = {
  findings: [],
  steps: [],
  verdicts: [],
  highlightPath: [{ from: "issue-queued", to: "analyze" }],
};

/** The service over spies. */
function harness() {
  const workflows = {
    find: jest.fn().mockResolvedValue(workflow()),
    draftOf: jest.fn().mockResolvedValue(row(DRAFTED, null)),
    versionAt: jest.fn().mockResolvedValue(row(PUBLISHED, 14)),
  };
  const issues = {
    issue: jest.fn().mockResolvedValue({ number: 485, labels: ["bug", "i2c"], effort: "m" }),
  };
  const engine = { dryRunWorkflow: jest.fn().mockResolvedValue(WALK) };

  const service = new WorkflowDryRunService(
    workflows as unknown as WorkflowsRepository,
    issues as unknown as WorkflowDryRunRepository,
    engine as unknown as EngineClient,
  );

  return { service, workflows, issues, engine };
}

describe("the dry-run service", () => {
  it("walks the stored draft for the issue's ticket, and relays the walk", async () => {
    const { service, issues, engine } = harness();

    const answer = await service.dryRun(WORKSPACE, WORKFLOW, { issueId: ISSUE });

    expect(issues.issue).toHaveBeenCalledWith(WORKSPACE, ISSUE);
    expect(engine.dryRunWorkflow).toHaveBeenCalledWith(DRAFTED, {
      externalKey: "#485",
      source: "github",
      labels: ["bug", "i2c"],
      estimate: { effort: "m" },
    });
    expect(answer).toEqual({
      ticket: {
        externalKey: "#485",
        source: "github",
        labels: ["bug", "i2c"],
        estimate: { effort: "m" },
      },
      findings: [],
      steps: [],
      verdicts: [],
      highlightPath: [{ from: "issue-queued", to: "analyze" }],
    });
  });

  it("walks the version in force for a workflow with no draft open", async () => {
    const { service, workflows, engine } = harness();
    workflows.draftOf.mockResolvedValue(undefined);

    await service.dryRun(WORKSPACE, WORKFLOW, { issueId: ISSUE });

    expect(workflows.versionAt).toHaveBeenCalledWith(WORKFLOW, 14);
    expect(engine.dryRunWorkflow).toHaveBeenCalledWith(PUBLISHED, expect.anything());
  });

  it("refuses with 409 when there is neither a draft nor a version to walk", async () => {
    const { service, workflows, engine } = harness();
    workflows.draftOf.mockResolvedValue(undefined);
    workflows.find.mockResolvedValue(workflow({ current_version: null }));

    await expect(service.dryRun(WORKSPACE, WORKFLOW, { issueId: ISSUE })).rejects.toMatchObject({
      code: "workflow_draft_absent",
    });
    expect(workflows.versionAt).not.toHaveBeenCalled();
    expect(engine.dryRunWorkflow).not.toHaveBeenCalled();
  });

  it("answers 404 for a workflow this workspace cannot see, before reading any issue", async () => {
    const { service, workflows, issues, engine } = harness();
    workflows.find.mockResolvedValue(undefined);

    await expect(service.dryRun(WORKSPACE, WORKFLOW, { issueId: ISSUE })).rejects.toMatchObject({
      code: "workflow_not_found",
    });
    expect(workflows.find).toHaveBeenCalledWith(WORKSPACE, WORKFLOW);
    expect(issues.issue).not.toHaveBeenCalled();
    expect(engine.dryRunWorkflow).not.toHaveBeenCalled();
  });

  it("answers 404 for an issue this workspace does not hold, and never asks the engine", async () => {
    const { service, issues, engine } = harness();
    issues.issue.mockResolvedValue(undefined);

    await expect(service.dryRun(WORKSPACE, WORKFLOW, { issueId: ISSUE })).rejects.toMatchObject({
      code: "workflow_dry_run_issue_not_found",
    });
    expect(engine.dryRunWorkflow).not.toHaveBeenCalled();
  });

  it("marks the engine's findings as the engine's, anchored as the publish gate anchors them", async () => {
    const { service, engine } = harness();
    engine.dryRunWorkflow.mockResolvedValue({
      ...WALK,
      highlightPath: [],
      findings: [
        { code: "unreachable_node", message: "Nothing reaches this node.", node: "review" },
      ],
    });

    const answer = await service.dryRun(WORKSPACE, WORKFLOW, { issueId: ISSUE });

    expect(answer.findings).toEqual([
      {
        source: "engine",
        code: "unreachable_node",
        message: "Nothing reaches this node.",
        node: "review",
      },
    ]);
  });

  it("lets the engine's unavailability travel, since nothing here can stand in for a walk", async () => {
    const { service, engine } = harness();
    const unavailable = new Error("engine_unavailable");
    engine.dryRunWorkflow.mockRejectedValue(unavailable);

    await expect(service.dryRun(WORKSPACE, WORKFLOW, { issueId: ISSUE })).rejects.toBe(unavailable);
  });
});
