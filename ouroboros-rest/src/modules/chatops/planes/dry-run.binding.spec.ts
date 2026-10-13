import type { BacklogDetailService } from "../../backlog/detail.service";
import type { DryRun } from "../../db/schema";
import type { DryRunAftermath } from "../../dry-runs/dry-runs.aftermath";
import type { DryRunsService } from "../../dry-runs/dry-runs.service";
import type { DryRunSuggestionsService } from "../../dry-runs/suggestions.service";
import { ENGINE_DRY_RUN_TIMEOUT_MS } from "../../engine/engine.dryruns";
import { ConflictError, InvalidRequestError, NotFoundError } from "../../errors/error.envelope";
import type { WorkflowRegistryService } from "../../workflows/registry.service";
import type { TriggerService } from "../../workflows/trigger.service";
import { WORKFLOW_ERRORS } from "../../workflows/workflows.errors";
import type { WorkflowsService } from "../../workflows/workflows.service";
import type { BindingResult, CommandReply, ResolvedArgument } from "../grammar.types";
import { DryRunBinding } from "./dry-run.binding";
import { CHAT_PLANE_ERRORS } from "./planes.errors";
import { APP_URL, bindsOf, contextFor, strictDouble, WORKSPACE } from "./planes.fixture";

/**
 * `/ouro dry-run <ticket> [workflow]` (#537) starts a run through `DryRunsService.start` — the
 * call `POST /api/v1/workflows/:id/dry-runs` makes (`DryRunsController.start`:
 * `this.dryRuns.start(tenant.id, params.id, body)`, the body being the ticket and the draft
 * revision). *"No writes, no PRs"* is the harness's guards', inside that service; what this
 * suite holds is that the binding adds no path around them.
 *
 * Every double is strict, and between them they expose **one** method that changes anything:
 * `start`. The rest are reads (`draftBase`, `detailOf`, `pin`, `offered`, `list`) and one
 * in-process registration (`register`). A binding that queued the ticket, opened a draft, saved
 * a workflow or filed a suggestion would reach for a method that is not there and fail.
 */

/** `#486`, resolved, with the canonical ticket a dry run is started against. */
const TICKET: Extract<ResolvedArgument, { type: "ticket" }> = {
  type: "ticket",
  issueId: "issue-486",
  number: 486,
  repository: "helios-firmware",
  ticketId: "ticket-486",
};

const WORKFLOW: ResolvedArgument = { type: "workflow", slug: "standard-fix" };

/** Where a dry run of `standard-fix` is followed. */
const LINK = { label: "Workflow Copilot", url: `${APP_URL}/workflows/standard-fix/copilot` };

/** The run as `start` answers once the harness has it. */
const STARTED = {
  id: "dry-run-1",
  status: "running",
  failureReason: null,
  totals: { durationMs: null, costCents: null },
  guardsClean: true,
  guardAudit: [],
};

/**
 * A `dry_runs` row as the aftermath announces it.
 *
 * @param overrides - What differs from a clean, complete run.
 * @returns The row.
 */
function ended(overrides: Partial<DryRun> = {}): DryRun {
  return {
    id: "dry-run-1",
    organization_id: WORKSPACE,
    workflow_id: "workflow-1",
    status: "complete",
    failure_reason: null,
    duration_ms: "174000",
    cost_cents: 42,
    guards_clean: true,
    guard_audit: [],
    ...overrides,
  } as unknown as DryRun;
}

describe("the /ouro dry-run binding", () => {
  let start: jest.Mock;
  let register: jest.Mock;
  let list: jest.Mock;
  let draftBase: jest.Mock;
  let pin: jest.Mock;
  let offered: jest.Mock;
  let detailOf: jest.Mock;
  let binding: DryRunBinding;

  /**
   * Announce a run's ending, as `DryRunAftermath` tells every registered listener.
   *
   * @param run - The run, as it ended.
   */
  async function announce(run: DryRun): Promise<void> {
    const [listener] = register.mock.calls[0] as [(run: DryRun) => Promise<void>];

    await listener(run);
  }

  /**
   * The later message of a started command.
   *
   * @param result - What the binding returned.
   * @returns The promise the dispatcher posts from.
   */
  function later(result: BindingResult): Promise<CommandReply> {
    if (result.kind !== "started")
      throw new Error(`Expected a started command, got ${result.kind}.`);

    return result.result;
  }

  beforeEach(() => {
    start = jest.fn().mockResolvedValue(STARTED);
    register = jest.fn();
    list = jest.fn().mockResolvedValue({ dryRunId: "dry-run-1", suggestions: [{}, {}] });
    draftBase = jest
      .fn()
      .mockResolvedValue({ workflow: { id: "workflow-1", slug: "standard-fix", draft_rev: 7 } });
    pin = jest.fn().mockResolvedValue([{ slug: "standard-fix", version: 14 }]);
    offered = jest.fn().mockResolvedValue({ slugs: ["standard-fix", "deep-fix"] });
    detailOf = jest.fn().mockResolvedValue({
      issue: { labels: ["bug", "firmware"] },
      estimate: { effort: "m", suggestedWorkflow: "standard-fix" },
    });
    binding = new DryRunBinding(
      strictDouble<DryRunsService>("DryRunsService", { start }),
      strictDouble<DryRunAftermath>("DryRunAftermath", { register }),
      strictDouble<DryRunSuggestionsService>("DryRunSuggestionsService", { list }),
      strictDouble<WorkflowsService>("WorkflowsService", { draftBase }),
      strictDouble<TriggerService>("TriggerService", { pin }),
      strictDouble<WorkflowRegistryService>("WorkflowRegistryService", { offered }),
      strictDouble<BacklogDetailService>("BacklogDetailService", { detailOf }),
    );
    binding.onModuleInit();
  });

  afterEach(() => {
    // Settles anything still waiting, and clears its deadline timer.
    binding.onModuleDestroy();
    jest.useRealTimers();
  });

  it("serves the dry-run command, which the registry binds to the workflow's dry-runs route", () => {
    expect(binding.command).toBe("dry-run");
    expect(bindsOf("dry-run")).toBe("POST /api/v1/workflows/{id}/dry-runs");
  });

  it("registers with the aftermath once, the way the copilot's debrief does", () => {
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(expect.any(Function));
  });

  describe("with the workflow typed", () => {
    const context = contextFor("dry-run", { ticket: TICKET, workflow: WORKFLOW });

    it("starts the run against the canonical ticket and the workflow's draft revision", async () => {
      await binding.run(context);

      expect(draftBase).toHaveBeenCalledTimes(1);
      expect(draftBase).toHaveBeenCalledWith(WORKSPACE, "standard-fix");
      expect(start).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledWith(WORKSPACE, "workflow-1", {
        ticketId: "ticket-486",
        draftRev: 7,
      });
    });

    it("evaluates no trigger and reads no issue: the workflow was named", async () => {
      await binding.run(context);

      expect(detailOf).not.toHaveBeenCalled();
      expect(pin).not.toHaveBeenCalled();
      expect(offered).not.toHaveBeenCalled();
    });

    it("acknowledges at once with mockup 19's sentence and the Copilot link", async () => {
      const result = await binding.run(context);

      expect(result).toMatchObject({
        kind: "started",
        reply: {
          text: "Dry run started — no writes, no PRs. Results in ~3 min → follow in Workflow Copilot",
          link: LINK,
        },
        ref: { dryRunId: "dry-run-1", workflow: "standard-fix", issueNumber: 486 },
      });
      // Acknowledged before anything is known of the result: no ending has been announced.
      expect(list).not.toHaveBeenCalled();
    });

    it("posts the result as its own message once the aftermath announces the ending", async () => {
      const result = later(await binding.run(context));
      let posted: CommandReply | undefined;
      void result.then((reply) => {
        posted = reply;
      });

      await Promise.resolve();
      expect(posted).toBeUndefined();

      await announce(ended());

      expect(await result).toEqual({
        text: "Dry run of standard-fix on #486 complete · 2m 54s · $0.42 · guards clean · 2 suggestions → open in Workflow Copilot",
        link: LINK,
      });
      expect(list).toHaveBeenCalledTimes(1);
      expect(list).toHaveBeenCalledWith(WORKSPACE, "workflow-1", "dry-run-1");
    });

    it("finds an ending announced between the start and the command listening for it", async () => {
      start.mockImplementation(async () => {
        await announce(ended());

        return STARTED;
      });

      const reply = await later(await binding.run(context));

      expect(reply.text).toMatch(/^Dry run of standard-fix on #486 complete · /);
    });

    it("hears only its own run", async () => {
      const result = later(await binding.run(context));
      let settled = false;
      void result.then(() => {
        settled = true;
      });

      await announce(ended({ id: "dry-run-of-somebody-else" }));
      await Promise.resolve();

      expect(settled).toBe(false);
    });

    it("says a run that failed, with the service's reason, as the result message", async () => {
      list.mockResolvedValue({ dryRunId: "dry-run-1", suggestions: [] });
      const result = later(await binding.run(context));

      await announce(
        ended({
          status: "failed",
          failure_reason: "stage implement exhausted its retries",
          cost_cents: null,
          guards_clean: false,
          guard_audit: [{}, {}, {}] as unknown as DryRun["guard_audit"],
        }),
      );

      expect(await result).toEqual({
        // No price where a stage had none; the guard audit is counted, not summarised away.
        text: "Dry run of standard-fix on #486 failed: stage implement exhausted its retries · 2m 54s · 3 writes blocked by the guards → open in Workflow Copilot",
        link: LINK,
      });
    });

    it("does not lose the result when the suggestions cannot be read", async () => {
      list.mockRejectedValue(new NotFoundError("dry_run_not_found", "No such dry run."));
      const result = later(await binding.run(context));

      await announce(ended());

      expect((await result).text).toBe(
        "Dry run of standard-fix on #486 complete · 2m 54s · $0.42 · guards clean → open in Workflow Copilot",
      );
    });

    it("claims no result when the harness deadline passes with nothing heard", async () => {
      jest.useFakeTimers();
      const result = later(await binding.run(context));

      jest.advanceTimersByTime(ENGINE_DRY_RUN_TIMEOUT_MS);

      expect(await result).toEqual({
        text: "Dry run of standard-fix on #486 has not reported an ending yet — follow it in Workflow Copilot",
        link: LINK,
      });
      expect(list).not.toHaveBeenCalled();
    });

    it("settles a waiting command at shutdown, so no promise is left pending", async () => {
      const result = later(await binding.run(context));

      binding.onModuleDestroy();

      expect((await result).text).toBe(
        "Dry run of standard-fix on #486 has not reported an ending yet — follow it in Workflow Copilot",
      );
    });

    it("answers at once, with nothing to follow, when the draft failed its pre-check", async () => {
      start.mockResolvedValue({
        ...STARTED,
        status: "failed",
        failureReason: "the draft has a stage with no exit",
        totals: { durationMs: 900, costCents: 0 },
      });

      expect(await binding.run(context)).toEqual({
        kind: "done",
        reply: {
          text: "Dry run of standard-fix on #486 failed: the draft has a stage with no exit · 1s · $0.00 · guards clean → open in Workflow Copilot",
          link: LINK,
        },
        ref: { dryRunId: "dry-run-1", workflow: "standard-fix", issueNumber: 486 },
      });
    });

    it.each([
      [
        "dry_run_in_progress",
        new ConflictError("dry_run_in_progress", "A dry run of this workflow is already running."),
      ],
      [
        "dry_run_source_unsupported",
        new InvalidRequestError(
          "dry_run_source_unsupported",
          "That ticket source cannot be rehearsed.",
        ),
      ],
    ])("relays the service's %s refusal as the plane threw it", async (_code, refusal) => {
      start.mockRejectedValue(refusal);

      await expect(binding.run(context)).rejects.toBe(refusal);
    });

    it("relays workflow_not_found from the draft read as thrown, and starts nothing", async () => {
      const refusal = new NotFoundError(WORKFLOW_ERRORS.workflowNotFound, "No such workflow.");
      draftBase.mockRejectedValue(refusal);

      await expect(binding.run(context)).rejects.toBe(refusal);
      expect(start).not.toHaveBeenCalled();
    });

    it("says the service's draft-absent refusal in a dry run's words, code and status kept", async () => {
      const plane = new ConflictError(WORKFLOW_ERRORS.draftAbsent, "There is no draft to publish.");
      start.mockRejectedValue(plane);

      const refusal = await binding.run(context).catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(ConflictError);
      expect(refusal).toMatchObject({
        code: WORKFLOW_ERRORS.draftAbsent,
        message:
          "standard-fix has no open draft, and a dry run rehearses a workflow's draft. Open one in Workflow Copilot, then try again.",
        details: { workflow: "standard-fix" },
      });
    });
  });

  describe("with no workflow typed", () => {
    const context = contextFor("dry-run", { ticket: TICKET });

    it("takes the workflow trigger evaluation pins for the issue as it stands", async () => {
      pin.mockResolvedValue([{ slug: "deep-fix", version: 3 }]);

      const result = await binding.run(context);

      expect(detailOf).toHaveBeenCalledTimes(1);
      expect(detailOf).toHaveBeenCalledWith(WORKSPACE, "issue-486");
      expect(pin).toHaveBeenCalledTimes(1);
      expect(pin).toHaveBeenCalledWith(
        WORKSPACE,
        [
          {
            source: "github",
            labels: ["bug", "firmware"],
            effort: "m",
            suggestedWorkflow: "standard-fix",
          },
        ],
        undefined,
      );
      expect(draftBase).toHaveBeenCalledWith(WORKSPACE, "deep-fix");
      expect(result.reply.link?.url).toBe(`${APP_URL}/workflows/deep-fix/copilot`);
      expect(result.ref).toMatchObject({ workflow: "deep-fix" });
    });

    it("hands trigger evaluation an unsized issue as unsized", async () => {
      detailOf.mockResolvedValue({ issue: { labels: [] }, estimate: null });

      await binding.run(context);

      expect(pin).toHaveBeenCalledWith(
        WORKSPACE,
        [{ source: "github", labels: [], effort: null, suggestedWorkflow: "" }],
        undefined,
      );
    });

    it.each([
      ["no trigger claims it", []],
      ["the pin names no workflow", [{ slug: "", version: null }]],
    ])("refuses, listing the offered workflows, when %s", async (_why, pins) => {
      pin.mockResolvedValue(pins);

      const refusal = await binding.run(context).catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(InvalidRequestError);
      expect(refusal).toMatchObject({
        code: CHAT_PLANE_ERRORS.workflowUndecided,
        message:
          "No workflow's trigger claims #486 and it has no estimate to suggest one — name the workflow: /ouro dry-run #486 <workflow> (standard-fix, deep-fix).",
      });
      expect(offered).toHaveBeenCalledWith(WORKSPACE);
      expect(start).not.toHaveBeenCalled();
    });
  });

  it("refuses an issue with no canonical ticket before touching any plane", async () => {
    const refusal = await binding
      .run(contextFor("dry-run", { ticket: { ...TICKET, ticketId: null }, workflow: WORKFLOW }))
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(InvalidRequestError);
    expect(refusal).toMatchObject({
      code: CHAT_PLANE_ERRORS.ticketNotCanonical,
      details: { reference: "helios-firmware#486" },
    });
    for (const method of [start, draftBase, detailOf, pin, offered, list]) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it("makes exactly one call that changes anything across a whole run: the start", async () => {
    const result = later(await binding.run(contextFor("dry-run", { ticket: TICKET })));

    await announce(ended());
    await result;

    // Everything the binding did, on every plane. `start` is the route's own write; the rest
    // are reads. Any other method would have thrown out of its strict double.
    expect(start).toHaveBeenCalledTimes(1);
    expect(detailOf).toHaveBeenCalledTimes(1);
    expect(pin).toHaveBeenCalledTimes(1);
    expect(draftBase).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
    expect(offered).not.toHaveBeenCalled();
    expect(register).toHaveBeenCalledTimes(1);
  });
});
