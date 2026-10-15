import {
  ADMISSION_REASONS,
  effectiveCeiling,
  ITEM_ADMISSION_REASONS,
  itemAdmission,
  queueWaiting,
  WORKSPACE_ADMISSION_REASONS,
  workspaceAdmission,
  type ItemAdmissionFacts,
  type WorkspaceAdmissionFacts,
} from "./admission";

/** A workspace that admits. */
function workspace(overrides: Partial<WorkspaceAdmissionFacts> = {}): WorkspaceAdmissionFacts {
  return {
    deploymentEnabled: true,
    state: "active",
    executors: 1,
    liveSlotsTaken: 0,
    ceiling: 1,
    ...overrides,
  };
}

/** An item that admits. */
function item(overrides: Partial<ItemAdmissionFacts> = {}): ItemAdmissionFacts {
  return {
    repositoryEnabled: true,
    dryRun: true,
    workflowPublished: true,
    routeInvocable: true,
    confirmed: true,
    ...overrides,
  };
}

describe("the reason vocabulary", () => {
  it("is the workspace reasons then the item reasons, each once", () => {
    expect([...ADMISSION_REASONS]).toEqual([
      ...WORKSPACE_ADMISSION_REASONS,
      ...ITEM_ADMISSION_REASONS,
    ]);
    expect(new Set(ADMISSION_REASONS).size).toBe(ADMISSION_REASONS.length);
  });
});

describe("the workspace decision", () => {
  it("admits a workspace with the switch on, active, an executor and a free slot", () => {
    expect(workspaceAdmission(workspace())).toBeNull();
  });

  it("answers deployment_disabled while the switch is off, before anything else", () => {
    expect(
      workspaceAdmission(
        workspace({ deploymentEnabled: false, state: "paused", executors: 0, liveSlotsTaken: 9 }),
      ),
    ).toBe("deployment_disabled");
  });

  it("answers workspace_paused for a paused workspace", () => {
    expect(workspaceAdmission(workspace({ state: "paused", executors: 0 }))).toBe(
      "workspace_paused",
    );
  });

  it("answers workspace_pending_delete for a workspace being deleted", () => {
    expect(workspaceAdmission(workspace({ state: "pending_delete" }))).toBe(
      "workspace_pending_delete",
    );
  });

  it("answers no_executor before the ceiling", () => {
    expect(workspaceAdmission(workspace({ executors: 0, liveSlotsTaken: 1 }))).toBe("no_executor");
  });

  it("answers concurrency_ceiling once the slots taken reach the ceiling", () => {
    expect(workspaceAdmission(workspace({ liveSlotsTaken: 1, ceiling: 1 }))).toBe(
      "concurrency_ceiling",
    );
    expect(workspaceAdmission(workspace({ liveSlotsTaken: 1, ceiling: 2 }))).toBeNull();
  });
});

describe("the item decision", () => {
  it("admits an item every fact allows", () => {
    expect(itemAdmission(item())).toBeNull();
  });

  it.each([
    ["repository_disabled", { repositoryEnabled: false }],
    ["policy_not_dry_run", { dryRun: false }],
    ["workflow_unpublished", { workflowPublished: false }],
    ["route_not_invocable", { routeInvocable: false }],
    ["needs_confirmation", { confirmed: false }],
  ] as const)("answers %s", (reason, facts) => {
    expect(itemAdmission(item(facts))).toBe(reason);
  });

  it("names the first reason in precedence order when several hold", () => {
    const none = item({
      repositoryEnabled: false,
      dryRun: false,
      workflowPublished: false,
      routeInvocable: false,
      confirmed: false,
    });

    expect(itemAdmission(none)).toBe("repository_disabled");
    expect(itemAdmission({ ...none, repositoryEnabled: true })).toBe("policy_not_dry_run");
    expect(itemAdmission({ ...none, repositoryEnabled: true, dryRun: true })).toBe(
      "workflow_unpublished",
    );
    expect(
      itemAdmission({ ...none, repositoryEnabled: true, dryRun: true, workflowPublished: true }),
    ).toBe("route_not_invocable");
  });
});

describe("why a queued item waits", () => {
  it("is null for an item that would be admitted now", () => {
    expect(queueWaiting(workspace(), item())).toBeNull();
  });

  it("puts the hard workspace reasons before the item's own", () => {
    expect(
      queueWaiting(workspace({ deploymentEnabled: false }), item({ confirmed: false })),
    ).toEqual({ reason: "deployment_disabled", scope: "workspace" });
    expect(queueWaiting(workspace({ state: "paused" }), item({ dryRun: false }))).toEqual({
      reason: "workspace_paused",
      scope: "workspace",
    });
    expect(queueWaiting(workspace({ executors: 0 }), item({ confirmed: false }))).toEqual({
      reason: "no_executor",
      scope: "workspace",
    });
  });

  it("shows the item's own reason before a full ceiling, which clears by itself", () => {
    expect(queueWaiting(workspace({ liveSlotsTaken: 1 }), item({ confirmed: false }))).toEqual({
      reason: "needs_confirmation",
      scope: "item",
    });
  });

  it("shows the ceiling last, for an item nothing else holds", () => {
    expect(queueWaiting(workspace({ liveSlotsTaken: 1 }), item())).toEqual({
      reason: "concurrency_ceiling",
      scope: "workspace",
    });
  });
});

describe("the effective ceiling", () => {
  it("is the workspace's own, never above the deployment's maximum", () => {
    expect(effectiveCeiling(1, 4)).toBe(1);
    expect(effectiveCeiling(10, 4)).toBe(4);
    expect(effectiveCeiling(4, 4)).toBe(4);
  });
});
