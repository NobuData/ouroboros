import { AUDIT_ACTIONS } from "../audit/audit.events";
import {
  DERIVED_EVENT_TYPES,
  LATEST_REGISTRY_VERSION,
  WEBHOOK_REGISTRY,
  auditEventTypes,
  familyOf,
  registeredTypes,
  subscriptionEntryProblem,
  subscriptionMatches,
} from "./webhook.registry";

/**
 * The registry's three promises (#487): **matching is exact** (a family wildcard covers its own
 * family and nothing else), **versions only grow by appending** (version 1 is frozen, so an
 * existing subscription never widens by itself), and **no audit action ships unregistered**.
 */

describe("the webhook event registry", () => {
  it("numbers its versions densely from 1", () => {
    expect(WEBHOOK_REGISTRY.map((entry) => entry.version)).toEqual(
      WEBHOOK_REGISTRY.map((_, index) => index + 1),
    );
    expect(LATEST_REGISTRY_VERSION).toBe(WEBHOOK_REGISTRY.length);
  });

  it("registers no type twice across versions", () => {
    const all = WEBHOOK_REGISTRY.flatMap((entry) => entry.adds);

    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps every type in one of the four families and V098's grammar", () => {
    for (const type of registeredTypes(LATEST_REGISTRY_VERSION)) {
      expect(familyOf(type)).toBeDefined();
      expect(type).toMatch(/^(audit|decision|run|pr)(\.[a-z][a-z0-9_]*)+$/);
    }
  });

  it("registers every audit action, and its derived type, in some version", () => {
    // A new audit action must append a registry version before it can ship: its webhook type is
    // a decision, not an accident of a computed list.
    const registered = registeredTypes(LATEST_REGISTRY_VERSION);

    for (const action of AUDIT_ACTIONS) {
      for (const type of auditEventTypes(action)) {
        expect(registered.has(type)).toBe(true);
      }
    }
  });

  it("holds version 1 to what it published — 77 audit types, three decision, eight PR and three run types", () => {
    const v1 = WEBHOOK_REGISTRY[0].adds;

    expect(v1.filter((type) => type.startsWith("run."))).toEqual([
      "run.opened",
      "run.merged",
      "run.canceled",
    ]);
    expect(v1.filter((type) => type.startsWith("decision."))).toEqual([
      "decision.filed",
      "decision.refreshed",
      "decision.source_resolved",
    ]);
    expect(v1.filter((type) => type.startsWith("pr."))).toEqual([
      "pr.criterion_verified",
      "pr.criterion_unverified",
      "pr.criterion_waived",
      "pr.approval_requested",
      "pr.approval_approved",
      "pr.approval_declined",
      "pr.thread_resolved",
      "pr.merged",
    ]);
    expect(v1.filter((type) => type.startsWith("audit."))).toHaveLength(77);
    expect(v1).toHaveLength(77 + 3 + 3 + 8);
  });

  it("derives decision and PR types only from those families' audit actions", () => {
    for (const [action, derived] of Object.entries(DERIVED_EVENT_TYPES)) {
      const family = action.split(".")[0].startsWith("pr_") ? "pr" : action.split(".")[0];

      expect(familyOf(derived)).toBe(family);
    }
  });
});

describe("which types an audit row fans out as", () => {
  it("is audit.<action> alone for an ordinary action", () => {
    expect(auditEventTypes("provider.rotated")).toEqual(["audit.provider.rotated"]);
  });

  it("adds the decision type for a decision action", () => {
    expect(auditEventTypes("decision.filed")).toEqual(["audit.decision.filed", "decision.filed"]);
  });

  it("adds the pr type for a PR verification action", () => {
    expect(auditEventTypes("pr_thread.resolved")).toEqual([
      "audit.pr_thread.resolved",
      "pr.thread_resolved",
    ]);
  });
});

describe("whether a subscription is sent an event", () => {
  it("sends audit.* every audit event and nothing else", () => {
    const audit = ["audit.*"];

    expect(subscriptionMatches(audit, 1, "audit.provider.rotated")).toBe(true);
    expect(subscriptionMatches(audit, 1, "audit.decision.filed")).toBe(true);
    expect(subscriptionMatches(audit, 1, "decision.filed")).toBe(false);
    expect(subscriptionMatches(audit, 1, "run.merged")).toBe(false);
    expect(subscriptionMatches(audit, 1, "pr.merged")).toBe(false);
    expect(subscriptionMatches(audit, 1, "ping")).toBe(false);
  });

  it("matches an exact type and nothing beside it", () => {
    const merged = ["run.merged"];

    expect(subscriptionMatches(merged, 1, "run.merged")).toBe(true);
    expect(subscriptionMatches(merged, 1, "run.opened")).toBe(false);
  });

  it("never sends a type the endpoint's registry version does not have", () => {
    expect(subscriptionMatches(["audit.*"], 1, "audit.provider.teleported")).toBe(false);
  });
});

describe("validating a subscription entry", () => {
  it("accepts the four wildcards and every registered type", () => {
    expect(subscriptionEntryProblem("pr.*", 1)).toBeUndefined();
    expect(subscriptionEntryProblem("run.canceled", 1)).toBeUndefined();
  });

  it("refuses an unregistered type, naming the version", () => {
    expect(subscriptionEntryProblem("run.exploded", 1)).toMatch(/registered in version 1/);
    expect(subscriptionEntryProblem("billing.*", 1)).toMatch(/neither a family wildcard/);
  });
});
