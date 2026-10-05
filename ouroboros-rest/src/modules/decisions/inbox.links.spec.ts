import { SHIPPED_KINDS } from "./decision.kinds.fixture";
import type { DecisionRef } from "./decision.types";
import {
  NAVIGATE_PREFIX,
  SOURCE_RESOLVED,
  UI_ROUTES,
  linkedRefs,
  navigationHref,
  policyHref,
  refHref,
} from "./inbox.links";

/**
 * Where a card's tags and link actions lead (#467): resolved from the declaration's binding and
 * the item's own refs, so the card component holds no route and no kind.
 */

const RUN: DecisionRef = {
  type: "run",
  id: "5eed0009-0000-4000-8000-000000001844",
  label: "loop #1844",
};
const PR: DecisionRef = {
  type: "pr",
  id: "5eed003a-0000-4000-8000-000000000504",
  label: "PR #504",
};
const TICKET: DecisionRef = {
  type: "ticket",
  id: "5eed0040-0000-4000-8000-000000000479",
  label: "issue #479",
};
const PATH: DecisionRef = {
  type: "path",
  id: "boot/rollback_flag.c",
  label: "boot/rollback_flag.c",
};

describe("the UI's routes, restated", () => {
  it("are the literals ouroboros-ui/app/paths.ts writes down", () => {
    expect(UI_ROUTES.run("r 1")).toBe("/runs/r%201");
    expect(UI_ROUTES.runChanges("r1")).toBe("/runs/r1#run-changes");
    expect(UI_ROUTES.pr("p1")).toBe("/prs/p1");
    expect(UI_ROUTES.prCriteria("p1")).toBe("/prs/p1#criteria");
    expect(UI_ROUTES.intake("#465")).toBe("/issues?q=%23465");
    expect(UI_ROUTES.planningBatch("b1")).toBe("/planning?batch=b1");
    expect(UI_ROUTES.knowledgeFacts).toBe("/knowledge#facts-awaiting");
    expect(UI_ROUTES.protectedPaths).toBe("/knowledge#repo-profile");
    expect(UI_ROUTES.policies).toBe("/settings#policies");
  });
});

describe("where an answering policy is configured (#468)", () => {
  it("leads a rule of the org policy to Settings' policies section", () => {
    expect(policyHref("auto_accept_resize")).toBe("/settings#policies");
  });

  it("leads nowhere for a person's answer, or for an item its source settled", () => {
    expect(policyHref(null)).toBeNull();
    expect(policyHref(SOURCE_RESOLVED)).toBeNull();
    expect(SOURCE_RESOLVED).toBe("source_resolved");
  });
});

describe("ref tags", () => {
  it("lead to the run console, PR verification, intake and the diff", () => {
    expect(linkedRefs([RUN, PR, TICKET, PATH])).toEqual([
      { ...RUN, href: `/runs/${RUN.id}` },
      { ...PR, href: `/prs/${PR.id}` },
      { ...TICKET, href: "/issues?q=%23479" },
      { ...PATH, href: `/runs/${RUN.id}#run-changes` },
    ]);
  });

  it("leave a path on an item with no run as a tag, not a link", () => {
    expect(refHref(PATH, [PR, PATH])).toBeNull();
  });

  it("keep the emitter's order and every field", () => {
    expect(linkedRefs([PATH, RUN]).map((ref) => ref.label)).toEqual([PATH.label, RUN.label]);
  });
});

describe("link actions", () => {
  const context = { refs: [RUN, PR, TICKET, PATH], sourceRef: "planning:batch:b-490" };

  it.each([
    ["navigate.pr_verification", `/prs/${PR.id}`],
    ["navigate.pr_evidence", `/prs/${PR.id}#criteria`],
    ["navigate.run_console", `/runs/${RUN.id}`],
    ["navigate.run_plan", `/runs/${RUN.id}`],
    ["navigate.run_diff", `/runs/${RUN.id}#run-changes`],
    ["navigate.protected_paths_settings", "/knowledge#repo-profile"],
    ["navigate.knowledge_fact", "/knowledge#facts-awaiting"],
    ["navigate.planning_batch", "/planning?batch=b-490"],
    ["navigate.ticket", "/issues?q=%23479"],
  ])("%s leads to %s", (binding, href) => {
    expect(navigationHref(binding, context)).toBe(href);
  });

  it("give an answering action no destination", () => {
    expect(navigationHref("pr.approve_and_merge", context)).toBeNull();
    expect(navigationHref("guardrail.allow_once", context)).toBeNull();
  });

  it("give an unknown target, or one whose ref is missing, no destination — never a guess", () => {
    expect(navigationHref("navigate.somewhere_new", context)).toBeNull();
    expect(navigationHref("navigate.pr_verification", { refs: [RUN], sourceRef: "" })).toBeNull();
    expect(
      navigationHref("navigate.planning_batch", { refs: [], sourceRef: "fact:f-1" }),
    ).toBeNull();
    expect(
      navigationHref("navigate.planning_batch", { refs: [], sourceRef: "planning:batch:" }),
    ).toBeNull();
    expect(navigationHref("navigate.ticket", { refs: [RUN], sourceRef: "" })).toBeNull();
  });

  it("know every link target a shipped kind declares — a new target cannot ship unresolved", () => {
    const targets = Object.values(SHIPPED_KINDS)
      .flatMap((kind) => kind.actions)
      .map((action) => action.handler_binding)
      .filter((binding) => binding.startsWith(NAVIGATE_PREFIX));

    expect(targets.length).toBeGreaterThan(0);

    for (const binding of targets) {
      expect({ binding, href: navigationHref(binding, context) }).toEqual({
        binding,
        href: expect.stringMatching(/^\//) as unknown,
      });
    }
  });
});
