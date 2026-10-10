import { DomainError } from "../errors/error.envelope";
import { emitStatusOf, sameDeclaration } from "./decision-kind.registry";
import {
  FIXTURE_KIND,
  MOCKUP_PROSE,
  SEEDED_PAYLOADS,
  SHIPPED_KINDS,
} from "./decision.kinds.fixture";
import { registryHarness, type RegistryHarness } from "./decision.store.fixture";
import type { DecisionEmission } from "./decision.types";

/**
 * `DecisionKindRegistry` (#461): emit is validated, idempotent, audited and told; closures are
 * policy(source_resolved); dormant kinds file nothing; a kind no migration declares joins with no
 * change here.
 */

const ORG = "acme-robotics";
const RUN = "0a1b2c3d-0000-4000-8000-000000001851";
const PR = "0a1b2c3d-0000-4000-8000-000000000509";

/** The mockup's merge-approval emission for PR #509. */
function mergeApproval(overrides: Partial<DecisionEmission> = {}): DecisionEmission {
  return {
    organizationId: ORG,
    kindId: "merge_approval",
    payload: SEEDED_PAYLOADS.merge_approval,
    refs: [
      { type: "run", id: RUN, label: "loop #1843" },
      { type: "pr", id: PR, label: "PR #509" },
    ],
    key: { plane: "pr.gates", sourceRef: `pr:${PR}` },
    ...overrides,
  };
}

/** The mockup's protected-path emission for loop #1851. */
function protectedPath(): DecisionEmission {
  return {
    organizationId: ORG,
    kindId: "protected_path_allow_once",
    payload: SEEDED_PAYLOADS.protected_path_allow_once,
    refs: [
      { type: "run", id: RUN, label: "loop #1851" },
      { type: "path", id: "boot/rollback_flag.c", label: "boot/rollback_flag.c" },
    ],
    key: { plane: "guardrails", sourceRef: `run:${RUN}:path:boot/rollback_flag.c` },
  };
}

let harness: RegistryHarness;

beforeEach(() => {
  harness = registryHarness();
});

describe("emit", () => {
  it("files a new item, audits decision.filed with no actor, and tells the lifecycle", async () => {
    const outcome = await harness.registry.emit(mergeApproval());

    expect(outcome.status).toBe("filed");
    expect(harness.store.items).toHaveLength(1);
    expect(harness.store.items[0]).toMatchObject({
      kindVersion: 1,
      severity: "err",
      status: "open",
    });
    expect(harness.audit).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        actorId: null,
        action: "decision.filed",
        subjectType: "decision_item",
        subjectId: outcome.itemId,
        detail: {
          kind: "merge_approval",
          version: 1,
          plane: "pr.gates",
          sourceRef: `pr:${PR}`,
          severity: "err",
        },
      }),
    ]);
    expect(harness.events).toEqual([
      { type: "filed", itemId: outcome.itemId, organizationId: ORG, kindId: "merge_approval" },
    ]);
  });

  it("is a no-op on an exact repeat — an AP.3 evaluation fired three times for one stage files one card", async () => {
    const first = await harness.registry.emit(protectedPath());
    const second = await harness.registry.emit(protectedPath());
    const third = await harness.registry.emit(protectedPath());

    expect([first.status, second.status, third.status]).toEqual([
      "filed",
      "unchanged",
      "unchanged",
    ]);
    expect(new Set([first.itemId, second.itemId, third.itemId]).size).toBe(1);
    expect(harness.store.items).toHaveLength(1);
    expect(harness.audit.map((record) => record.action)).toEqual(["decision.filed"]);
    expect(harness.events).toHaveLength(1);
  });

  it("refreshes an open item whose facts moved, and audits that", async () => {
    await harness.registry.emit(mergeApproval());
    const outcome = await harness.registry.emit(
      mergeApproval({ payload: { ...SEEDED_PAYLOADS.merge_approval, checks_passed: 13 } }),
    );

    expect(outcome.status).toBe("refreshed");
    expect(harness.store.items[0].payload.checks_passed).toBe(13);
    expect(harness.audit.map((record) => record.action)).toEqual([
      "decision.filed",
      "decision.refreshed",
    ]);
  });

  it("leaves an answered item alone, and says it was settled", async () => {
    const { itemId } = await harness.registry.emit(mergeApproval());
    harness.store.resolve(String(itemId), "approve_merge", "human", null, "web");

    const outcome = await harness.registry.emit(
      mergeApproval({ payload: { ...SEEDED_PAYLOADS.merge_approval, checks_passed: 1 } }),
    );

    expect(outcome).toEqual({ status: "settled", itemId });
    expect(harness.store.items[0].payload.checks_passed).toBe(14);
    expect(harness.audit).toHaveLength(1);
  });

  it("refuses a payload failing its schema with a useful error, and files nothing", async () => {
    const { checks_total: _checks, ...payload } = SEEDED_PAYLOADS.merge_approval;
    const refusal = await harness.registry
      .emit(mergeApproval({ payload }))
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(DomainError);
    expect((refusal as DomainError).getStatus()).toBe(422);
    expect((refusal as DomainError).envelope()).toMatchObject({
      code: "decision_emission_invalid",
      message:
        "A merge_approval decision was refused and nothing was filed: payload.checks_total is a fact this kind's templates need, and it is missing.",
      details: { kindId: "merge_approval" },
    });
    expect(harness.store.emits).toBe(0);
    expect(harness.store.items).toEqual([]);
    expect(harness.audit).toEqual([]);
  });

  it("refuses refs that do not fit the kind, and a malformed key, filing nothing", async () => {
    await expect(
      harness.registry.emit(mergeApproval({ refs: [{ type: "pr", id: PR, label: "PR #509" }] })),
    ).rejects.toMatchObject({ code: "decision_emission_invalid" });
    await expect(
      harness.registry.emit(mergeApproval({ key: { plane: "pr:gates", sourceRef: "x" } })),
    ).rejects.toMatchObject({ code: "decision_emission_invalid" });
    expect(harness.store.emits).toBe(0);
  });

  it("refuses a kind with no declaration", async () => {
    await expect(
      harness.registry.emit(mergeApproval({ kindId: "bisect_complete" })),
    ).rejects.toMatchObject({ code: "decision_kind_not_declared" });
  });

  it("files nothing for spend_approval, which is registered but dormant", async () => {
    const outcome = await harness.registry.emit({
      organizationId: ORG,
      kindId: "spend_approval",
      payload: SEEDED_PAYLOADS.spend_approval,
      refs: [{ type: "run", id: RUN, label: "loop #1851" }],
      key: { plane: "spend", sourceRef: `run:${RUN}:spend` },
    });

    expect(outcome).toEqual({ status: "dormant", itemId: null });
    expect(harness.store.emits).toBe(0);
    expect(harness.audit).toEqual([]);
  });

  it("honours a severity override", async () => {
    await harness.registry.emit(mergeApproval({ severity: "warn" }));

    expect(harness.store.items[0].severity).toBe("warn");
  });
});

describe("kinds", () => {
  it("lists every declared kind at its newest version, spend_approval marked dormant", async () => {
    const kinds = await harness.registry.kinds();

    expect(kinds).toHaveLength(9);
    expect(kinds.filter((kind) => kind.dormant).map((kind) => kind.kind.kindId)).toEqual([
      "spend_approval",
    ]);
    expect(harness.registry.isDormant("merge_approval")).toBe(false);
  });
});

describe("a fixture kind, end to end, with no change to inbox core code", () => {
  it("registers, files, renders at its pinned version and resolves", async () => {
    const { version: _version, ...declaration } = FIXTURE_KIND;
    const published = await harness.registry.register({
      ...declaration,
      escalationWindow: "30 minutes",
    });

    expect(published.version).toBe(1);

    const { itemId } = await harness.registry.emit({
      organizationId: ORG,
      kindId: FIXTURE_KIND.kindId,
      payload: { rig: "helios-rig-02", minutes: 20, drift_c: 1.5 },
      refs: [{ type: "run", id: RUN, label: "loop #1851" }],
      key: { plane: "farm", sourceRef: `run:${RUN}:soak` },
    });
    const stored = harness.store.items[0];
    const pinned = await harness.registry.pinnedKind(stored.kindId, stored.kindVersion);

    expect(harness.registry.render(pinned, stored.payload)).toEqual({
      question: "Let the oven at helios-rig-02 run 20 minutes over?",
      why: "helios-rig-02 drifted 1.5°C off its setpoint; extending lets the soak finish.",
      tags: ["helios-rig-02", "farm"],
    });
    expect(
      harness.registry
        .actionsFor(pinned, { roles: ["member"], canApproveLoops: false })
        .map((action) => [action.id, action.allowed]),
    ).toEqual([
      ["extend", true],
      ["open_rig", true],
      ["abort", false],
    ]);
    expect(
      await harness.registry.resolveFromSource({
        itemId: String(itemId),
        organizationId: ORG,
        settlement: "run_terminated",
        channel: "api",
      }),
    ).toBe(true);
    expect(harness.store.items[0].status).toBe("resolved");
  });

  it("registering the same declaration again publishes nothing; a changed one is the next version", async () => {
    const { version: _version, ...declaration } = FIXTURE_KIND;

    await harness.registry.register(declaration);
    expect((await harness.registry.register(declaration)).version).toBe(1);

    const bumped = await harness.registry.register({
      ...declaration,
      whyTemplate: "{rig} drifted {drift_c}°C; extend to finish the soak.",
    });

    expect(bumped.version).toBe(2);
    expect(harness.store.kinds.filter((kind) => kind.kindId === FIXTURE_KIND.kindId)).toHaveLength(
      2,
    );
  });

  it("keeps an item filed before a bump rendering at the version it pinned", async () => {
    const { version: _version, ...declaration } = FIXTURE_KIND;
    await harness.registry.register(declaration);
    await harness.registry.emit({
      organizationId: ORG,
      kindId: FIXTURE_KIND.kindId,
      payload: { rig: "r", minutes: 5, drift_c: 0 },
      refs: [{ type: "run", id: RUN, label: "loop" }],
      key: { plane: "farm", sourceRef: "soak:1" },
    });
    await harness.registry.register({ ...declaration, questionTemplate: "Extend {rig}?" });

    const stored = harness.store.items[0];
    const pinned = await harness.registry.pinnedKind(stored.kindId, stored.kindVersion);

    expect(harness.registry.render(pinned, stored.payload).question).toBe(
      "Let the oven at r run 5 minutes over?",
    );
  });
});

describe("resolveFromSource", () => {
  it("closes a merge-class item as policy(source_resolved), audits it and tells the lifecycle", async () => {
    const { itemId } = await harness.registry.emit(mergeApproval());

    const closed = await harness.registry.resolveFromSource({
      itemId: String(itemId),
      organizationId: ORG,
      settlement: "pr_merged",
      channel: "github",
    });

    expect(closed).toBe(true);
    expect(harness.store.resolutions).toEqual([
      {
        itemId,
        actionId: "source_resolved",
        resolver: "policy",
        policy: "source_resolved",
        channel: "github",
        outcome: { source: "pr_merged" },
      },
    ]);
    expect(harness.audit.at(-1)).toMatchObject({
      action: "decision.source_resolved",
      actorId: null,
      subjectId: itemId,
      detail: { kind: "merge_approval", settlement: "pr_merged", channel: "github" },
    });
    expect(harness.events.at(-1)).toEqual({
      type: "resolved",
      itemId,
      organizationId: ORG,
      kindId: "merge_approval",
      resolver: "policy",
      policy: "source_resolved",
      actionId: "source_resolved",
      channel: "github",
      settlement: "pr_merged",
    });
  });

  it("does nothing, and says so, for an item no longer asking", async () => {
    const { itemId } = await harness.registry.emit(mergeApproval());
    const settled = {
      itemId: String(itemId),
      organizationId: ORG,
      settlement: "pr_merged" as const,
      channel: "github" as const,
    };

    await harness.registry.resolveFromSource(settled);
    const auditBefore = harness.audit.length;

    expect(await harness.registry.resolveFromSource(settled)).toBe(false);
    expect(harness.audit).toHaveLength(auditBefore);
  });
});

describe("render", () => {
  it("renders the mockup's prose from a stored item, and escapes for a destination", () => {
    expect(
      harness.registry.render(SHIPPED_KINDS.claim_waiver, SEEDED_PAYLOADS.claim_waiver),
    ).toEqual(MOCKUP_PROSE.claim_waiver);
    expect(
      harness.registry.render(
        SHIPPED_KINDS.claim_waiver,
        { claim: "<b>", missing_capability: "x" },
        "html",
      ).why,
    ).toContain("&lt;b&gt;");
  });
});

describe("emitStatusOf", () => {
  const emission = mergeApproval();

  it("compares facts and refs regardless of key order", () => {
    const reordered = Object.fromEntries(Object.entries(emission.payload).reverse());

    expect(
      emitStatusOf(
        { id: "x", status: "snoozed", payload: reordered, refs: emission.refs, severity: "err" },
        emission,
      ),
    ).toBe("unchanged");
  });

  it("reads an expired item as settled", () => {
    expect(
      emitStatusOf(
        {
          id: "x",
          status: "expired",
          payload: emission.payload,
          refs: emission.refs,
          severity: "err",
        },
        emission,
      ),
    ).toBe("settled");
  });
});

describe("sameDeclaration", () => {
  it("ignores the version and key order, and notices any changed field", () => {
    const { version: _version, ...declaration } = FIXTURE_KIND;

    expect(sameDeclaration(FIXTURE_KIND, declaration)).toBe(true);
    expect(sameDeclaration(FIXTURE_KIND, { ...declaration, mergeClass: true })).toBe(false);
  });
});
