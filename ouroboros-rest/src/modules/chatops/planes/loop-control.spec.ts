import type { ControlsService } from "../../controls/controls.service";
import { ForbiddenError, NotFoundError } from "../../errors/error.envelope";
import type { CommandBinding } from "../grammar.types";
import { AbortLoopBinding } from "./abort-loop.binding";
import { requestLoopControl } from "./loop-control";
import { PauseLoopBinding } from "./pause-loop.binding";
import { bindsOf, contextFor, LOOP, REQUESTER, strictDouble, WORKSPACE } from "./planes.fixture";
import { ResumeLoopBinding } from "./resume-loop.binding";

/**
 * `/ouro pause loop`, `resume loop` and `abort loop` (#537) are all `ControlsService.submit` —
 * the call `POST /api/v1/runs/:id/controls` makes when the run console's button is pressed
 * (`ControlsController.submit`: `this.controls.submit(member.tenant.id, params.id,
 * requester(member), request)`). The three bindings are one-line wrappers over
 * `loop-control.ts`, so they share this suite; the double has `submit` and nothing else, which
 * is what holds "there is no second way to reach the executor".
 */

/** The control as the queue answers a fresh request. */
const QUEUED = { id: "control-1", state: "queued", detail: null };

/** Each command: its binding, the request the console sends for it, and its acknowledgement. */
const CASES: readonly [
  string,
  new (controls: ControlsService) => CommandBinding,
  Record<string, string>,
  string,
][] = [
  [
    "pause loop",
    PauseLoopBinding,
    { kind: "pause" },
    "Pause requested for loop 1847 — it stops at its next safe boundary, never mid-write.",
  ],
  [
    "resume loop",
    ResumeLoopBinding,
    { kind: "resume" },
    "Resume requested for loop 1847 — it continues from where it stopped.",
  ],
  [
    "abort loop",
    AbortLoopBinding,
    // The console's abort dialog has a person type the loop number; chat sends the same.
    { kind: "abort", confirmation: "1847" },
    "Abort requested for loop 1847 — the run ends as canceled once the runner acknowledges, and its branch is kept.",
  ],
];

describe.each(CASES)("the /ouro %s binding", (command, Binding, request, acknowledgement) => {
  let submit: jest.Mock;
  let binding: CommandBinding;

  /** @returns The invocation: the loop, and `confirm` where the registry has one. */
  const context = (): ReturnType<typeof contextFor> =>
    contextFor(command, {
      loop: LOOP,
      ...(command === "abort loop" ? { confirm: { type: "confirm" as const } } : {}),
    });

  beforeEach(() => {
    submit = jest.fn().mockResolvedValue(QUEUED);
    binding = new Binding(strictDouble<ControlsService>("ControlsService", { submit }));
  });

  it("serves its command, which the registry binds to the run's controls route", () => {
    expect(binding.command).toBe(command);
    expect(bindsOf(command)).toBe(`POST /api/v1/runs/{id}/controls (${request.kind})`);
  });

  it("submits one control to the run's queue, as the invoker", async () => {
    await binding.run(context());

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(WORKSPACE, LOOP.runId, REQUESTER, request);
  });

  it("acknowledges a request — not a done deed — and says what the control will do", async () => {
    expect(await binding.run(context())).toEqual({
      kind: "done",
      reply: { text: acknowledgement },
      ref: { runId: LOOP.runId, loopSeq: 1847, controlId: "control-1" },
    });
  });

  it.each([
    ["forbidden", new ForbiddenError("forbidden", "Controls are for contributors.")],
    ["run_not_found", new NotFoundError("run_not_found", "No such run.")],
  ])("relays the queue's %s refusal as the plane threw it", async (_code, refusal) => {
    submit.mockRejectedValue(refusal);

    await expect(binding.run(context())).rejects.toBe(refusal);
  });
});

describe("requestLoopControl", () => {
  it.each([
    ["pause", "paused"],
    ["resume", "resumed"],
    ["abort", "aborted"],
  ] as const)(
    "relays the plane's reason when a %s is rejected, instead of claiming the loop was %s",
    async (kind, notDone) => {
      const submit = jest.fn().mockResolvedValue({
        id: "control-2",
        state: "rejected",
        detail: "The run has already finished.",
      });

      const result = await requestLoopControl(
        strictDouble<ControlsService>("ControlsService", { submit }),
        kind,
        contextFor(`${kind} loop`, { loop: LOOP }),
      );

      expect(result).toEqual({
        kind: "done",
        reply: { text: `Loop 1847 was not ${notDone}: The run has already finished.` },
        ref: { runId: LOOP.runId, loopSeq: 1847, controlId: "control-2" },
      });
    },
  );

  it("still says the control was rejected when the plane gave no reason", async () => {
    const submit = jest
      .fn()
      .mockResolvedValue({ id: "control-3", state: "rejected", detail: null });

    const result = await requestLoopControl(
      strictDouble<ControlsService>("ControlsService", { submit }),
      "pause",
      contextFor("pause loop", { loop: LOOP }),
    );

    expect(result.reply.text).toBe("Loop 1847 was not paused: the control was rejected.");
  });

  it("is a wiring fault, not a reply, when the registry hands it no loop", async () => {
    const submit = jest.fn();

    await expect(
      requestLoopControl(
        strictDouble<ControlsService>("ControlsService", { submit }),
        "pause",
        contextFor("pause loop"),
      ),
    ).rejects.toThrow('The /ouro binding expected a loop argument named "loop".');
    expect(submit).not.toHaveBeenCalled();
  });
});
