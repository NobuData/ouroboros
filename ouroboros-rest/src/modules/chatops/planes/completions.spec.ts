import type { TicketLookupRepository } from "../../backlog/ticket.lookup.repository";
import type { InboxQueueService } from "../../decisions/inbox.queue";
import type { RegistryService } from "../../registry/registry.service";
import type { RoutingManagementService } from "../../routing/management.service";
import type { LoopLookupRepository } from "../../runs/loop.lookup.repository";
import type { WorkflowRegistryService } from "../../workflows/registry.service";
import type { Completion } from "../grammar.ports";
import { GRAMMAR } from "../grammar.registry";
import type { CompletionSource } from "../grammar.types";
import { PlaneCompletionSources } from "./completions";
import { INVOKER, strictDouble, WORKSPACE } from "./planes.fixture";

/**
 * Completions for the `/ouro` grammar's arguments (#537): one source per vocabulary, each read
 * from the plane that owns it — the reads `resolvers.ts` validates against, so nothing is
 * offered that would then be refused. The doubles are strict, one method each, so a source
 * answered from anywhere else has nothing to call.
 */

/** The Needs-You queue as the invoker's inbox page shows it. */
const QUEUE = {
  items: [
    {
      shortId: "q-231",
      question: "Allow a write outside the ticket's paths?",
      actions: [
        { id: "allow_once", label: "Allow once", navigates: false, allowed: true },
        { id: "allow_always", label: "Always allow", navigates: false, allowed: false },
        { id: "open_run", label: "Open the run", navigates: true, allowed: true },
        { id: "deny", label: "Deny", navigates: false, allowed: true },
      ],
    },
    { shortId: "q-232", question: "Approve the plan for #490?", actions: [] },
    { shortId: "q-240", question: "Merge PR #514?", actions: [] },
  ],
};

describe("the /ouro completion sources", () => {
  let open: jest.Mock;
  let live: jest.Mock;
  let queue: jest.Mock;
  let offered: jest.Mock;
  let list: jest.Mock;
  let matrix: jest.Mock;
  let sources: PlaneCompletionSources;

  /** Every plane read, to assert which one a source made. */
  const reads = (): Record<string, jest.Mock> => ({ open, live, queue, offered, list, matrix });

  /**
   * Complete an argument as the invoker.
   *
   * @param source - Which vocabulary.
   * @param prefix - What has been typed.
   * @param previous - The raw arguments before it.
   * @param limit - The most to return.
   * @returns The completions.
   */
  function complete(
    source: CompletionSource,
    prefix = "",
    previous: Readonly<Record<string, string>> = {},
    limit = 10,
  ): Promise<Completion[]> {
    return sources.complete(WORKSPACE, INVOKER, source, prefix, previous, limit);
  }

  beforeEach(() => {
    open = jest.fn().mockResolvedValue([
      { number: 485, title: "Telemetry drops frames", repository: "helios-firmware" },
      { number: 486, title: "Retry the uplink", repository: "helios-firmware" },
    ]);
    live = jest.fn().mockResolvedValue([
      { loopSeq: 1847, issueNumber: 482, issueTitle: "Fix the IMU drift", status: "running" },
      { loopSeq: 1851, issueNumber: 484, issueTitle: "Bump the SDK", status: "paused" },
    ]);
    queue = jest.fn().mockResolvedValue(QUEUE);
    offered = jest.fn().mockResolvedValue({ slugs: ["standard-fix", "feature-loop", "deep-fix"] });
    list = jest.fn().mockResolvedValue([
      { alias: "claude-opus-4", modelId: "opus-4-20260301" },
      { alias: "claude-fable-5", modelId: "fable-5-20260901" },
      { alias: "local-qwen", modelId: "qwen3-coder" },
    ]);
    matrix = jest.fn().mockResolvedValue({
      taskKinds: [
        { name: "plan", description: "Planning the change" },
        { name: "implement", description: "Writing the change" },
        { name: "review", description: "Reviewing the change" },
      ],
    });
    sources = new PlaneCompletionSources(
      strictDouble<TicketLookupRepository>("TicketLookupRepository", { open }),
      strictDouble<LoopLookupRepository>("LoopLookupRepository", { live }),
      strictDouble<InboxQueueService>("InboxQueueService", { queue }),
      strictDouble<WorkflowRegistryService>("WorkflowRegistryService", { offered }),
      strictDouble<RegistryService>("RegistryService", { list }),
      strictDouble<RoutingManagementService>("RoutingManagementService", { matrix }),
    );
  });

  it.each([
    ["tickets", "open"],
    ["loops", "live"],
    ["workflows", "offered"],
    ["aliases", "list"],
    ["task_kinds", "matrix"],
    ["questions", "queue"],
    ["actions", "queue"],
  ] as const)("answers %s from its owning plane's %s, and from no other", async (source, read) => {
    await complete(source, "", { question: "q-231" });

    for (const [name, mock] of Object.entries(reads())) {
      expect(mock).toHaveBeenCalledTimes(name === read ? 1 : 0);
    }
  });

  it("has a source for every completion the registry's arguments name", async () => {
    const named = new Set(
      GRAMMAR.commands.flatMap((command) =>
        command.arguments.flatMap((argument) => argument.completion ?? []),
      ),
    );

    expect([...named].sort()).toEqual([
      "actions",
      "aliases",
      "loops",
      "questions",
      "task_kinds",
      "tickets",
      "workflows",
    ]);
    for (const source of named) {
      expect((await complete(source, "", { question: "q-231" })).length).toBeGreaterThan(0);
    }
  });

  it("offers nothing, and reads nothing, for a limit of none", async () => {
    expect(await complete("tickets", "48", {}, 0)).toEqual([]);

    for (const mock of Object.values(reads())) expect(mock).not.toHaveBeenCalled();
  });

  it("offers nothing for a source it does not know", async () => {
    expect(await complete("runners" as CompletionSource)).toEqual([]);
  });

  describe("tickets", () => {
    it("offers open issues by number with their titles", async () => {
      expect(await complete("tickets", "48", {}, 5)).toEqual([
        { value: "#485", label: "Telemetry drops frames" },
        { value: "#486", label: "Retry the uplink" },
      ]);
      expect(open).toHaveBeenCalledWith(WORKSPACE, "48", 5);
    });

    it("reads a leading # as the number's own spelling", async () => {
      await complete("tickets", " #48 ", {}, 5);

      expect(open).toHaveBeenCalledWith(WORKSPACE, "48", 5);
    });

    it("passes a title prefix through to the lookup", async () => {
      await complete("tickets", "Telem", {}, 5);

      expect(open).toHaveBeenCalledWith(WORKSPACE, "Telem", 5);
    });

    it("spells two offered issues sharing a number by repository, so each is one issue", async () => {
      open.mockResolvedValue([
        { number: 485, title: "Telemetry drops frames", repository: "helios-firmware" },
        { number: 485, title: "Paginate the index", repository: "atlas-api" },
        { number: 486, title: "Retry the uplink", repository: "helios-firmware" },
      ]);

      expect((await complete("tickets", "48")).map((entry) => entry.value)).toEqual([
        "helios-firmware#485",
        "atlas-api#485",
        "#486",
      ]);
    });
  });

  describe("loops", () => {
    it("offers loops in flight by number, with the issue each is working and its status", async () => {
      expect(await complete("loops", "18", {}, 5)).toEqual([
        { value: "1847", label: "#482 Fix the IMU drift · running" },
        { value: "1851", label: "#484 Bump the SDK · paused" },
      ]);
      expect(live).toHaveBeenCalledWith(WORKSPACE, "18", 5);
    });

    it("drops a leading #", async () => {
      await complete("loops", "#18", {}, 5);

      expect(live).toHaveBeenCalledWith(WORKSPACE, "18", 5);
    });

    it("completes anything that is not a number to nothing, without a read", async () => {
      expect(await complete("loops", "latest")).toEqual([]);
      expect(live).not.toHaveBeenCalled();
    });
  });

  describe("workflows", () => {
    it("offers the workspace's workflows", async () => {
      expect(await complete("workflows")).toEqual([
        { value: "standard-fix", label: "workflow" },
        { value: "feature-loop", label: "workflow" },
        { value: "deep-fix", label: "workflow" },
      ]);
      expect(offered).toHaveBeenCalledWith(WORKSPACE);
    });

    it("narrows by prefix, case-insensitively, and stops at the limit", async () => {
      expect((await complete("workflows", "FEAT")).map((entry) => entry.value)).toEqual([
        "feature-loop",
      ]);
      expect(await complete("workflows", "", {}, 2)).toHaveLength(2);
    });
  });

  describe("aliases", () => {
    it("offers the registry's aliases with the model each names", async () => {
      expect(await complete("aliases", "claude")).toEqual([
        { value: "claude-opus-4", label: "opus-4-20260301" },
        { value: "claude-fable-5", label: "fable-5-20260901" },
      ]);
      expect(list).toHaveBeenCalledWith(WORKSPACE);
    });

    it("does not complete a raw model id to anything", async () => {
      expect(await complete("aliases", "fable-5-2026")).toEqual([]);
    });
  });

  describe("task_kinds", () => {
    it("offers the routing matrix's kinds with their descriptions", async () => {
      expect(await complete("task_kinds", "im")).toEqual([
        { value: "implement", label: "Writing the change" },
      ]);
      expect(matrix).toHaveBeenCalledWith(WORKSPACE);
    });
  });

  describe("questions", () => {
    it("offers the questions asking the invoker, read as the invoker", async () => {
      expect(await complete("questions", "q-23")).toEqual([
        { value: "q-231", label: "Allow a write outside the ticket's paths?" },
        { value: "q-232", label: "Approve the plan for #490?" },
      ]);
      expect(queue).toHaveBeenCalledWith(WORKSPACE, {
        userId: INVOKER.userId,
        roles: INVOKER.roles,
      });
    });
  });

  describe("actions", () => {
    it("offers the answers the invoker may give the question typed before", async () => {
      expect(await complete("actions", "", { question: "q-231" })).toEqual([
        { value: "allow_once", label: "Allow once" },
        { value: "deny", label: "Deny" },
      ]);
      expect(queue).toHaveBeenCalledWith(WORKSPACE, {
        userId: INVOKER.userId,
        roles: INVOKER.roles,
      });
    });

    it("offers neither a link nor an action they may not press", async () => {
      const values = (await complete("actions", "", { question: "q-231" })).map(
        (entry) => entry.value,
      );

      expect(values).not.toContain("open_run");
      expect(values).not.toContain("allow_always");
    });

    it("reads the question's id however it was cased or padded, and narrows by prefix", async () => {
      expect(await complete("actions", "DE", { question: " Q-231 " })).toEqual([
        { value: "deny", label: "Deny" },
      ]);
    });

    it("offers nothing when no asking question is named before it", async () => {
      expect(await complete("actions", "", {})).toEqual([]);
      expect(await complete("actions", "", { question: "q-999" })).toEqual([]);
    });
  });
});
