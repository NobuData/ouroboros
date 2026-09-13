import { Logger } from "@nestjs/common";

import type { TriggerSpec } from "./dsl.schema";
import type { TriggerRepository, WorkflowTriggerRow } from "./trigger.repository";
import { TriggerService, type QueuedTicket } from "./trigger.service";

/**
 * Which rows may claim a ticket ([#143](https://github.com/NobuData/ouroboros/issues/143)).
 *
 * The rules themselves — explicit wins, specificity, alphabetical, the suggestion — are
 * `trigger.evaluation.spec.ts`'. What only this suite can see is what the database rows *become*:
 * paused and archived workflows never match, a draft-only workflow cannot be matched but can be
 * chosen, a trigger that does not parse is skipped rather than fatal, and one workspace's
 * workflows never reach another workspace's tickets.
 */

const WORKSPACE = "acme-robotics-id";
const OTHER_WORKSPACE = "rival-works-id";

/**
 * The warning a broken trigger produces, silenced for every case and asserted in one, for
 * `registry.service.spec.ts`' reason about log lines beside passing tests.
 */
let warned: jest.SpyInstance;

beforeEach(() => {
  warned = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
});

/** A stored trigger with these conditions. */
function trigger(conditions: TriggerSpec["conditions"] = {}): TriggerSpec {
  return { event: "ticket_queued", conditions };
}

/** One workflow row: active, published at v1, firing for every ticket unless told otherwise. */
function row(slug: string, overrides: Partial<WorkflowTriggerRow> = {}): WorkflowTriggerRow {
  return { slug, status: "active", current_version: 1, trigger: trigger(), ...overrides };
}

/** Mockup 04's `#485`: effort M, a bug, from GitHub — suggested `docs-loop` by its estimate. */
function ticket(overrides: Partial<QueuedTicket> = {}): QueuedTicket {
  return {
    source: "github",
    labels: ["bug"],
    effort: "m",
    suggestedWorkflow: "docs-loop",
    ...overrides,
  };
}

/** Mockup 04's rail, as `R__dev_seed_workflows.sql` seeds it — `hotfix-p0` paused. */
const MOCKUP_04: readonly WorkflowTriggerRow[] = [
  row("deps-refresh", { trigger: trigger({ labels: ["dependencies", "tech-debt"] }) }),
  row("docs-loop", { trigger: trigger({ effort_lte: "s", labels: ["docs"] }) }),
  row("feature-loop", { trigger: trigger({ labels: ["enhancement"] }) }),
  row("hotfix-p0", { status: "paused", trigger: trigger({ labels: ["p0", "priority-high"] }) }),
  row("standard-fix", { current_version: 14, trigger: trigger({ effort_lte: "m" }) }),
];

/**
 * A service over a repository that answers per workspace.
 *
 * @param byWorkspace - The rows each workspace holds. A workspace not named holds none.
 * @returns The service, and the workspaces the repository was asked about.
 */
function build(byWorkspace: Readonly<Record<string, readonly WorkflowTriggerRow[]>>) {
  const asked: string[] = [];

  const repository = {
    triggers: (organizationId: string) => {
      asked.push(organizationId);
      return Promise.resolve([...(byWorkspace[organizationId] ?? [])]);
    },
  } as unknown as TriggerRepository;

  return { service: new TriggerService(repository), asked };
}

describe("the trigger service", () => {
  it("claims the mockup's #485 for standard-fix, pinned at v14", async () => {
    // standard-fix (≤ M ✓), feature-loop (needs `enhancement` ✗), hotfix-p0 (paused ✗).
    const { service, asked } = build({ [WORKSPACE]: MOCKUP_04 });

    const [pin] = await service.pin(WORKSPACE, [ticket()], undefined);

    expect(pin).toEqual({
      slug: "standard-fix",
      version: 14,
      reason: "predicate",
      matched: [{ slug: "standard-fix", version: 14, specificity: 1 }],
    });
    expect(asked).toEqual([WORKSPACE]);
  });

  describe("paused and archived workflows", () => {
    it("never match, even when theirs would be the most specific trigger", async () => {
      // `hotfix-p0`'s two labels would beat standard-fix's one condition if it were active.
      const { service } = build({ [WORKSPACE]: MOCKUP_04 });

      const [pin] = await service.pin(
        WORKSPACE,
        [ticket({ labels: ["p0", "priority-high"] })],
        undefined,
      );

      expect(pin).toMatchObject({ slug: "standard-fix", reason: "predicate" });
      expect(pin.matched.map((match) => match.slug)).not.toContain("hotfix-p0");
    });

    it("never match when they are the only trigger that fits", async () => {
      const { service } = build({ [WORKSPACE]: MOCKUP_04 });

      const [pin] = await service.pin(
        WORKSPACE,
        [ticket({ effort: "xl", labels: ["p0", "priority-high"] })],
        undefined,
      );

      expect(pin).toEqual({ slug: "docs-loop", version: 1, reason: "suggested", matched: [] });
    });

    it("leave an archived workflow out as well", async () => {
      const { service } = build({ [WORKSPACE]: [row("retired", { status: "archived" })] });

      const [pin] = await service.pin(WORKSPACE, [ticket()], undefined);

      expect(pin).toMatchObject({ slug: "docs-loop", reason: "suggested" });
    });

    it("still have a version to pin when the estimate suggested one of them", async () => {
      // The suggestion is copied as the estimate made it (decision F8); the pin records what was
      // in force, and T.6 re-checks the status when it claims the item.
      const { service } = build({ [WORKSPACE]: MOCKUP_04 });

      const [pin] = await service.pin(
        WORKSPACE,
        [ticket({ effort: "xl", suggestedWorkflow: "hotfix-p0" })],
        undefined,
      );

      expect(pin).toMatchObject({ slug: "hotfix-p0", version: 1, reason: "suggested" });
    });
  });

  describe("a workflow with nothing published", () => {
    const DRAFT_ONLY = row("release-train", { current_version: null, trigger: null });

    it("cannot be matched, because there is no version a pin could name", async () => {
      const { service } = build({ [WORKSPACE]: [DRAFT_ONLY] });

      const [pin] = await service.pin(WORKSPACE, [ticket()], undefined);

      expect(pin).toMatchObject({ slug: "docs-loop", version: null, reason: "suggested" });
    });

    it("can still be chosen explicitly, pinned at null", async () => {
      const { service } = build({ [WORKSPACE]: [DRAFT_ONLY] });

      const [pin] = await service.pin(WORKSPACE, [ticket()], "release-train");

      expect(pin).toEqual({
        slug: "release-train",
        version: null,
        reason: "explicit",
        matched: [],
      });
    });
  });

  describe("a trigger that does not parse", () => {
    it("is skipped rather than failing the queue write, and a warning names it", async () => {
      const { service } = build({
        [WORKSPACE]: [
          row("closed-loop", { trigger: { event: "ticket_closed", conditions: {} } }),
          row("garbled", { current_version: 3, trigger: "effort <= m" }),
        ],
      });

      const [pin] = await service.pin(WORKSPACE, [ticket()], undefined);

      expect(pin).toMatchObject({ slug: "docs-loop", reason: "suggested" });
      expect(warned).toHaveBeenCalledTimes(2);
      expect(warned).toHaveBeenCalledWith(expect.stringContaining("closed-loop"));
      expect(warned).toHaveBeenCalledWith(expect.stringContaining(WORKSPACE));
    });

    it("does not hide a well-formed trigger beside it", async () => {
      const { service } = build({
        [WORKSPACE]: [
          row("garbled", { trigger: { conditions: {} } }),
          row("standard-fix", { current_version: 14, trigger: trigger({ effort_lte: "m" }) }),
        ],
      });

      const [pin] = await service.pin(WORKSPACE, [ticket()], undefined);

      expect(pin).toMatchObject({ slug: "standard-fix", version: 14, reason: "predicate" });
    });
  });

  describe("an explicit choice", () => {
    it("wins over the trigger that would have claimed the ticket, at its own version", async () => {
      const { service } = build({ [WORKSPACE]: MOCKUP_04 });

      const [pin] = await service.pin(WORKSPACE, [ticket()], "feature-loop");

      expect(pin).toMatchObject({ slug: "feature-loop", version: 1, reason: "explicit" });
      expect(pin.matched.map((match) => match.slug)).toEqual(["standard-fix"]);
    });
  });

  describe("a workspace with no workflows", () => {
    it("keeps each issue's own suggestion, with nothing published to pin", async () => {
      // The bootstrap vocabulary: `registry.service.ts` offers the four built-ins, and none of them
      // is a row with a version.
      const { service } = build({});

      const pins = await service.pin(
        WORKSPACE,
        [ticket({ suggestedWorkflow: "standard-fix" }), ticket({ suggestedWorkflow: "docs-loop" })],
        undefined,
      );

      expect(pins).toEqual([
        { slug: "standard-fix", version: null, reason: "suggested", matched: [] },
        { slug: "docs-loop", version: null, reason: "suggested", matched: [] },
      ]);
    });
  });

  describe("a selection", () => {
    it("answers one pin per ticket, in the order it was given, from one read", async () => {
      const { service, asked } = build({ [WORKSPACE]: MOCKUP_04 });

      const pins = await service.pin(
        WORKSPACE,
        [
          ticket(),
          ticket({ effort: "xs", labels: ["docs"] }),
          ticket({ effort: "xl", labels: ["dependencies", "tech-debt"] }),
        ],
        undefined,
      );

      expect(pins.map((pin) => [pin.slug, pin.reason])).toEqual([
        ["standard-fix", "predicate"],
        ["docs-loop", "most_specific"],
        ["deps-refresh", "predicate"],
      ]);
      expect(asked).toEqual([WORKSPACE]);
    });

    it("reads nothing for an empty selection", async () => {
      const { service, asked } = build({ [WORKSPACE]: MOCKUP_04 });

      await expect(service.pin(WORKSPACE, [], undefined)).resolves.toEqual([]);
      expect(asked).toEqual([]);
    });
  });

  describe("another workspace's workflows", () => {
    it("never claim this workspace's ticket", async () => {
      // The ticket's cross-org criterion: the read is scoped, so a rival's catch-all trigger is not
      // a candidate here however well it fits.
      const { service, asked } = build({
        [OTHER_WORKSPACE]: [row("rival-fix", { current_version: 9 })],
      });

      const [pin] = await service.pin(WORKSPACE, [ticket()], undefined);

      expect(pin).toEqual({ slug: "docs-loop", version: null, reason: "suggested", matched: [] });
      expect(asked).toEqual([WORKSPACE]);
    });

    it("do not lend this workspace a version for a slug they share", async () => {
      // Two workspaces may both have a `standard-fix`; only the queueing workspace's own v14 or
      // nothing may be pinned.
      const { service } = build({
        [OTHER_WORKSPACE]: [row("standard-fix", { current_version: 14 })],
      });

      const [pin] = await service.pin(
        WORKSPACE,
        [ticket({ suggestedWorkflow: "standard-fix" })],
        undefined,
      );

      expect(pin).toMatchObject({ slug: "standard-fix", version: null, reason: "suggested" });
    });

    it("still claim their own workspace's tickets", async () => {
      const { service } = build({
        [WORKSPACE]: [],
        [OTHER_WORKSPACE]: [row("rival-fix", { current_version: 9 })],
      });

      const [pin] = await service.pin(OTHER_WORKSPACE, [ticket()], undefined);

      expect(pin).toMatchObject({ slug: "rival-fix", version: 9, reason: "predicate" });
    });
  });
});
