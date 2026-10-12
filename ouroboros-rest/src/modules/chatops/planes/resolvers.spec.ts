import type { TicketLookupRepository } from "../../backlog/ticket.lookup.repository";
import type { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import type { InboxQueueService } from "../../decisions/inbox.queue";
import type { QuestionLookupRepository } from "../../decisions/question.lookup.repository";
import { ForbiddenError } from "../../errors/error.envelope";
import { aliasNotFound } from "../../registry/registry.errors";
import type { RegistryService } from "../../registry/registry.service";
import type { RoutingManagementService } from "../../routing/management.service";
import type { LoopLookupRepository } from "../../runs/loop.lookup.repository";
import type { WorkflowRegistryService } from "../../workflows/registry.service";
import { ChatArgumentError } from "../grammar.ports";
import type { ArgumentSpec, ArgumentType, ResolvedArgument } from "../grammar.types";
import { strictDouble, WORKSPACE } from "./planes.fixture";
import {
  MAX_SUGGESTIONS,
  nearestFirst,
  parseTicket,
  PlaneArgumentResolvers,
  ticketSpellings,
} from "./resolvers";

/**
 * Turning what was typed into the thing it names (#537). Each vocabulary is read from the plane
 * that owns it, so the doubles are strict: a resolver that looked a workflow up anywhere but the
 * workflow registry, or matched a loop by anything but its exact number, reaches for a method
 * that is not there.
 *
 * Two properties carry the suite: **every spelling of one ticket is one ticket**, and **an
 * error teaches** — it names the argument, repeats what was typed and offers the valid names.
 */

/** `helios-firmware#485`, as the ticket lookup returns it. */
const ROW = {
  issueId: "issue-485",
  number: 485,
  title: "Telemetry drops frames",
  state: "open",
  owner: "acme-robotics",
  repository: "helios-firmware",
  ticketId: "ticket-485",
};

/** What every spelling of that issue resolves to. */
const RESOLVED_TICKET: ResolvedArgument = {
  type: "ticket",
  issueId: "issue-485",
  number: 485,
  repository: "helios-firmware",
  ticketId: "ticket-485",
};

/** The pinned kind of `q-231`, as the registry publishes it. */
const KIND = { id: "guardrail_block", version: 3, actions: [] };

/**
 * An argument's spec, as the registry would declare it.
 *
 * @param type - How the text is read.
 * @param name - The name an error is addressed to.
 * @returns The spec.
 */
function spec(type: ArgumentType, name: string = type): ArgumentSpec {
  return { name, type, optional: false, description: `a ${type}` };
}

describe("the /ouro argument resolvers", () => {
  let byNumber: jest.Mock;
  let byLoopSeq: jest.Mock;
  let live: jest.Mock;
  let byShortSeq: jest.Mock;
  let queue: jest.Mock;
  let pinnedKind: jest.Mock;
  let actionsFor: jest.Mock;
  let offered: jest.Mock;
  let resolveAlias: jest.Mock;
  let listAliases: jest.Mock;
  let matrix: jest.Mock;
  let resolvers: PlaneArgumentResolvers;

  /**
   * Resolve one argument in the workspace.
   *
   * @param type - The argument's type.
   * @param raw - What was typed.
   * @param previous - The arguments resolved before it.
   * @param name - The argument's name.
   * @returns The resolved argument.
   */
  function resolve(
    type: ArgumentType,
    raw: string,
    previous: Readonly<Record<string, ResolvedArgument>> = {},
    name: string = type,
  ): Promise<ResolvedArgument> {
    return resolvers.resolve(WORKSPACE, spec(type, name), raw, previous);
  }

  /**
   * The error a resolution is refused with.
   *
   * @param resolution - The resolution expected to fail.
   * @returns The `ChatArgumentError`.
   */
  async function refusal(resolution: Promise<unknown>): Promise<ChatArgumentError> {
    const error = await resolution.then(
      () => {
        throw new Error("Expected the argument to be refused.");
      },
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ChatArgumentError);

    return error as ChatArgumentError;
  }

  beforeEach(() => {
    byNumber = jest.fn().mockResolvedValue([ROW]);
    byLoopSeq = jest.fn().mockResolvedValue({ runId: "run-1847", loopSeq: 1847 });
    live = jest.fn().mockResolvedValue([{ loopSeq: 1847 }, { loopSeq: 1851 }]);
    byShortSeq = jest.fn().mockResolvedValue({
      itemId: "item-231",
      shortSeq: 231,
      status: "open",
      kindId: "guardrail_block",
      kindVersion: 3,
    });
    queue = jest.fn().mockResolvedValue({
      items: [231, 232, 233, 234, 235, 236].map((seq) => ({ shortId: `q-${String(seq)}` })),
    });
    pinnedKind = jest.fn().mockResolvedValue(KIND);
    actionsFor = jest.fn().mockReturnValue([
      { id: "allow_once", navigates: false },
      { id: "open_run", navigates: true },
      { id: "deny", navigates: false },
    ]);
    offered = jest.fn().mockResolvedValue({ slugs: ["standard-fix", "feature-loop", "deep-fix"] });
    resolveAlias = jest
      .fn()
      .mockResolvedValue({ alias: "claude-fable-5", modelId: "fable-5-20260901" });
    listAliases = jest.fn().mockResolvedValue([
      { alias: "claude-opus-4", modelId: "opus-4-20260301" },
      { alias: "claude-fable-5", modelId: "fable-5-20260901" },
    ]);
    matrix = jest.fn().mockResolvedValue({
      taskKinds: [{ name: "plan" }, { name: "implement" }, { name: "review" }],
    });
    resolvers = new PlaneArgumentResolvers(
      strictDouble<TicketLookupRepository>("TicketLookupRepository", { byNumber }),
      strictDouble<LoopLookupRepository>("LoopLookupRepository", { byLoopSeq, live }),
      strictDouble<QuestionLookupRepository>("QuestionLookupRepository", { byShortSeq }),
      strictDouble<InboxQueueService>("InboxQueueService", { queue }),
      strictDouble<DecisionKindRegistry>("DecisionKindRegistry", { pinnedKind, actionsFor }),
      strictDouble<WorkflowRegistryService>("WorkflowRegistryService", { offered }),
      strictDouble<RegistryService>("RegistryService", {
        resolve: resolveAlias,
        list: listAliases,
      }),
      strictDouble<RoutingManagementService>("RoutingManagementService", { matrix }),
    );
  });

  describe("a ticket", () => {
    it.each([
      "#485",
      "485",
      "  #485  ",
      "helios-firmware#485",
      "acme-robotics/helios-firmware#485",
      "https://github.com/acme-robotics/helios-firmware/issues/485",
      "https://www.github.com/acme-robotics/helios-firmware/issues/485#issuecomment-1",
      // Slack wraps a pasted URL in angle brackets.
      "<https://github.com/acme-robotics/helios-firmware/issues/485>",
    ])("resolves %s to the same issue", async (typed) => {
      expect(await resolve("ticket", typed)).toEqual(RESOLVED_TICKET);
      expect(byNumber).toHaveBeenCalledTimes(1);
    });

    it("looks a bare number up across the workspace, exactly", async () => {
      await resolve("ticket", "#485");

      expect(byNumber).toHaveBeenCalledWith(WORKSPACE, 485, undefined);
    });

    it("narrows to the repository a spelling names, and to its owner when it names one", async () => {
      await resolve("ticket", "helios-firmware#485");
      await resolve("ticket", "acme-robotics/helios-firmware#485");
      await resolve("ticket", "https://github.com/acme-robotics/helios-firmware/issues/485");

      expect(byNumber.mock.calls).toEqual([
        [WORKSPACE, 485, { name: "helios-firmware" }],
        [WORKSPACE, 485, { name: "helios-firmware", owner: "acme-robotics" }],
        [WORKSPACE, 485, { name: "helios-firmware", owner: "acme-robotics" }],
      ]);
    });

    it("carries a missing canonical twin as null rather than inventing one", async () => {
      byNumber.mockResolvedValue([{ ...ROW, ticketId: null }]);

      expect(await resolve("ticket", "#485")).toEqual({ ...RESOLVED_TICKET, ticketId: null });
    });

    it("refuses text that is no ticket, saying the forms it takes, without a read", async () => {
      const error = await refusal(resolve("ticket", "four-eighty-five"));

      expect(error.argument).toBe("ticket");
      expect(error.message).toBe(
        '"four-eighty-five" is not a ticket — use #485, repo#485, owner/repo#485 or a GitHub issue URL',
      );
      expect(byNumber).not.toHaveBeenCalled();
    });

    it("refuses a pull request URL as a pull request, not as an unknown issue", async () => {
      const url = "https://github.com/acme-robotics/helios-firmware/pull/514";
      const error = await refusal(resolve("ticket", url));

      expect(error.argument).toBe("ticket");
      expect(error.message).toBe(
        `${url} is a pull request, not an issue — name the issue: #485, repo#485 or its URL`,
      );
      expect(byNumber).not.toHaveBeenCalled();
    });

    it.each([
      ["#999", "no issue #999 in this workspace"],
      ["helios-firmware#999", "no issue #999 in helios-firmware"],
      ["acme-robotics/helios-firmware#999", "no issue #999 in acme-robotics/helios-firmware"],
    ])("says where it looked when %s names nothing", async (typed, message) => {
      byNumber.mockResolvedValue([]);

      const error = await refusal(resolve("ticket", typed));

      expect(error.argument).toBe("ticket");
      expect(error.message).toBe(message);
      expect(error.suggestions).toEqual([]);
    });

    it("refuses a number two repositories carry, spelling each so that it is one issue", async () => {
      byNumber.mockResolvedValue([ROW, { ...ROW, issueId: "issue-x", repository: "atlas-api" }]);

      const error = await refusal(resolve("ticket", "#485", {}, "issue"));

      expect(error.argument).toBe("issue");
      expect(error.message).toBe("#485 is in more than one repository — say which");
      expect(error.suggestions).toEqual(["helios-firmware#485", "atlas-api#485"]);
    });
  });

  describe("a loop", () => {
    it.each(["1847", "#1847", " 1847 "])(
      "resolves %s to the run carrying that number",
      async (typed) => {
        expect(await resolve("loop", typed)).toEqual({
          type: "loop",
          runId: "run-1847",
          loopSeq: 1847,
        });
        expect(byLoopSeq).toHaveBeenCalledWith(WORKSPACE, 1847);
        expect(live).not.toHaveBeenCalled();
      },
    );

    it("refuses a number no loop carries, offering the loops in flight", async () => {
      byLoopSeq.mockResolvedValue(undefined);

      const error = await refusal(resolve("loop", "#9999"));

      expect(error.argument).toBe("loop");
      expect(error.message).toBe("no loop 9999 in this workspace");
      expect(error.suggestions).toEqual(["1847", "1851"]);
      expect(live).toHaveBeenCalledWith(WORKSPACE, "", MAX_SUGGESTIONS);
    });

    it("refuses text that is no number without guessing at a loop", async () => {
      const error = await refusal(resolve("loop", "latest"));

      expect(error.message).toBe(
        '"latest" is not a loop number — use the number on the run, like 1847',
      );
      expect(error.suggestions).toEqual(["1847", "1851"]);
      expect(byLoopSeq).not.toHaveBeenCalled();
    });
  });

  describe("a question", () => {
    it.each(["q-231", "Q-231", "231"])("resolves %s to the item still asking", async (typed) => {
      expect(await resolve("question", typed)).toEqual({
        type: "question",
        itemId: "item-231",
        shortId: "q-231",
      });
      expect(byShortSeq).toHaveBeenCalledWith(WORKSPACE, 231);
      expect(queue).not.toHaveBeenCalled();
    });

    it.each([
      ["resolved", "q-231 was already answered"],
      ["expired", "q-231 expired before it was answered"],
    ])("refuses a question that is %s, in those words", async (status, message) => {
      byShortSeq.mockResolvedValue({ itemId: "item-231", shortSeq: 231, status });

      const error = await refusal(resolve("question", "q-231"));

      expect(error.argument).toBe("question");
      expect(error.message).toBe(message);
      expect(error.suggestions).toEqual([]);
    });

    it("refuses an unknown id, offering the ids asking — as nobody in particular", async () => {
      byShortSeq.mockResolvedValue(undefined);

      const error = await refusal(resolve("question", "q-999"));

      expect(error.message).toBe("no question q-999 in this workspace");
      expect(error.suggestions).toEqual(["q-231", "q-232", "q-233", "q-234", "q-235"]);
      expect(error.suggestions).toHaveLength(MAX_SUGGESTIONS);
      expect(queue).toHaveBeenCalledWith(WORKSPACE, { userId: null, roles: [] });
    });

    it("refuses text that is no short id without a lookup", async () => {
      const error = await refusal(resolve("question", "the-guardrail-one"));

      expect(error.message).toBe(
        '"the-guardrail-one" is not a question id — use the id on the card, like q-231',
      );
      expect(byShortSeq).not.toHaveBeenCalled();
    });
  });

  describe("an action", () => {
    const previous: Readonly<Record<string, ResolvedArgument>> = {
      question: { type: "question", itemId: "item-231", shortId: "q-231" },
    };

    it("resolves an answer the question's pinned kind declares", async () => {
      expect(await resolve("action", "allow_once", previous)).toEqual({
        type: "action",
        actionId: "allow_once",
      });
      expect(byShortSeq).toHaveBeenCalledWith(WORKSPACE, 231);
      expect(pinnedKind).toHaveBeenCalledWith("guardrail_block", 3);
    });

    it("asks what exists, not what this person may press: that is the executor's to decide", async () => {
      await resolve("action", "deny", previous);

      expect(actionsFor).toHaveBeenCalledWith(KIND, { roles: [], canApproveLoops: false });
    });

    it("refuses an unknown action, naming the question and offering its real answers", async () => {
      const error = await refusal(resolve("action", "allow", previous));

      expect(error.argument).toBe("action");
      expect(error.message).toBe('unknown action "allow" for q-231');
      expect(error.suggestions).toEqual(["allow_once", "deny"]);
    });

    it("does not take a link for an answer", async () => {
      const error = await refusal(resolve("action", "open_run", previous));

      expect(error.message).toBe('unknown action "open_run" for q-231');
      expect(error.suggestions).not.toContain("open_run");
    });

    it("offers nothing when the question has gone since it was named", async () => {
      byShortSeq.mockResolvedValue(undefined);

      const error = await refusal(resolve("action", "allow_once", previous));

      expect(error.suggestions).toEqual([]);
      expect(pinnedKind).not.toHaveBeenCalled();
    });

    it("is a wiring fault, not a reply, when no question was typed before it", async () => {
      const resolution = resolve("action", "allow_once", {});

      await expect(resolution).rejects.toThrow(
        'The /ouro grammar reads "action" against a question typed before it.',
      );
      await expect(resolution).rejects.not.toBeInstanceOf(ChatArgumentError);
    });
  });

  describe("a workflow", () => {
    it("resolves a slug the workspace offers", async () => {
      expect(await resolve("workflow", "standard-fix")).toEqual({
        type: "workflow",
        slug: "standard-fix",
      });
      expect(offered).toHaveBeenCalledWith(WORKSPACE);
    });

    it("refuses an unknown workflow, offering the valid slugs — the nearest first", async () => {
      const error = await refusal(resolve("workflow", "feature-lopp"));

      expect(error.argument).toBe("workflow");
      expect(error.message).toBe('unknown workflow "feature-lopp"');
      expect(error.suggestions).toEqual(["feature-loop", "standard-fix", "deep-fix"]);
    });

    it("does not accept a near miss as the workflow it resembles", async () => {
      const error = await refusal(resolve("workflow", "Standard-Fix"));

      expect(error.message).toBe('unknown workflow "Standard-Fix"');
      expect(error.suggestions[0]).toBe("standard-fix");
    });
  });

  describe("a model alias", () => {
    it("resolves through the registry, to the alias as the registry spells it", async () => {
      expect(await resolve("alias", "claude-fable-5")).toEqual({
        type: "alias",
        alias: "claude-fable-5",
      });
      expect(resolveAlias).toHaveBeenCalledWith(WORKSPACE, "claude-fable-5");
      expect(listAliases).not.toHaveBeenCalled();
    });

    it("refuses an unknown alias, offering the registry's aliases — the nearest first", async () => {
      resolveAlias.mockRejectedValue(aliasNotFound("claude-fable-6"));

      const error = await refusal(resolve("alias", "claude-fable-6"));

      expect(error.argument).toBe("alias");
      expect(error.message).toBe('unknown model alias "claude-fable-6"');
      expect(error.suggestions).toEqual(["claude-fable-5", "claude-opus-4"]);
      expect(listAliases).toHaveBeenCalledWith(WORKSPACE);
    });

    it("refuses a raw model id as a model id: routes name an alias", async () => {
      resolveAlias.mockRejectedValue(aliasNotFound("fable-5-20260901"));

      const error = await refusal(resolve("alias", "fable-5-20260901"));

      expect(error.message).toBe(
        '"fable-5-20260901" is a model id, not an alias — routes name an alias',
      );
      expect(error.suggestions).toEqual(["claude-opus-4", "claude-fable-5"]);
    });

    it("relays any other failure of the registry as it was thrown", async () => {
      const fault = new ForbiddenError("forbidden", "Not yours to read.");
      resolveAlias.mockRejectedValue(fault);

      await expect(resolve("alias", "claude-fable-5")).rejects.toBe(fault);
      expect(listAliases).not.toHaveBeenCalled();
    });
  });

  describe("a task kind", () => {
    it("resolves a kind the routing matrix lists", async () => {
      expect(await resolve("task_kind", "implement", {}, "task")).toEqual({
        type: "task_kind",
        name: "implement",
      });
      expect(matrix).toHaveBeenCalledWith(WORKSPACE);
    });

    it("refuses an unknown task kind, offering the matrix's kinds — the nearest first", async () => {
      const error = await refusal(resolve("task_kind", "implment", {}, "task"));

      expect(error.argument).toBe("task");
      expect(error.message).toBe('unknown task kind "implment"');
      expect(error.suggestions).toEqual(["implement", "plan", "review"]);
    });
  });

  describe("a pull request", () => {
    it.each(["514", "#514"])("reads %s as the number, with no lookup", async (typed) => {
      expect(await resolve("pr", typed)).toEqual({ type: "pr", number: 514 });
    });

    it("refuses text that is no number", async () => {
      const error = await refusal(resolve("pr", "the-big-one"));

      expect(error.argument).toBe("pr");
      expect(error.message).toBe('"the-big-one" is not a pull request number — like 514');
    });
  });

  it.each(["keyword", "confirm"] as const)(
    "treats a %s argument reaching it as a wiring fault: the parser settles those",
    async (type) => {
      const resolution = resolve(type, "confirm");

      await expect(resolution).rejects.toThrow(
        `The /ouro parser settles ${type} arguments; "${type}" reached the planes.`,
      );
      await expect(resolution).rejects.not.toBeInstanceOf(ChatArgumentError);
    },
  );
});

describe("parseTicket", () => {
  it.each([
    ["485", { number: 485 }],
    ["#485", { number: 485 }],
    ["helios-firmware#485", { repository: "helios-firmware", number: 485 }],
    [
      "acme-robotics/helios.firmware#485",
      { owner: "acme-robotics", repository: "helios.firmware", number: 485 },
    ],
    [
      "http://github.com/acme-robotics/helios-firmware/issues/485?notification=1",
      { owner: "acme-robotics", repository: "helios-firmware", number: 485 },
    ],
  ])("reads %s", (typed, reference) => {
    expect(parseTicket(typed)).toEqual(reference);
  });

  it("tells a pull request URL apart, whatever its case", () => {
    expect(parseTicket("https://github.com/acme-robotics/helios-firmware/PULL/514")).toBe(
      "pull_request",
    );
  });

  it.each([
    "",
    "#",
    "q-231",
    "#48five",
    "1234567890",
    "https://gitlab.com/acme-robotics/helios-firmware/issues/485",
    "https://github.com/acme-robotics/helios-firmware/issues",
  ])("reads %j as no ticket at all", (typed) => {
    expect(parseTicket(typed)).toBeUndefined();
  });
});

describe("nearestFirst", () => {
  const vocabulary = ["standard-fix", "feature-loop", "deep-fix"];

  it("puts the nearest name first and keeps the rest in the vocabulary's order", () => {
    expect(nearestFirst("feature-lopp", vocabulary)).toEqual([
      "feature-loop",
      "standard-fix",
      "deep-fix",
    ]);
  });

  it("offers the vocabulary as it stands when nothing is near", () => {
    expect(nearestFirst("zzzzzzzzzz", vocabulary)).toEqual(vocabulary);
  });

  it("offers no more than the limit", () => {
    const many = ["a1", "a2", "a3", "a4", "a5", "a6", "a7"];

    expect(nearestFirst("zzzzzzzzzz", many)).toHaveLength(MAX_SUGGESTIONS);
    expect(MAX_SUGGESTIONS).toBe(5);
  });
});

describe("ticketSpellings", () => {
  /**
   * A lookup row in a repository.
   *
   * @param owner - The GitHub organization.
   * @param repository - The repository.
   * @returns The row.
   */
  const row = (owner: string, repository: string): Parameters<typeof ticketSpellings>[0][number] =>
    ({ ...ROW, owner, repository }) as Parameters<typeof ticketSpellings>[0][number];

  it("spells each issue by its repository", () => {
    expect(
      ticketSpellings([row("acme-robotics", "helios-firmware"), row("acme-robotics", "atlas-api")]),
    ).toEqual(["helios-firmware#485", "atlas-api#485"]);
  });

  it("adds the owner when two repositories share a name, whatever their case", () => {
    expect(
      ticketSpellings([
        row("acme-robotics", "helios-firmware"),
        row("acme-labs", "Helios-Firmware"),
      ]),
    ).toEqual(["acme-robotics/helios-firmware#485", "acme-labs/Helios-Firmware#485"]);
  });
});
