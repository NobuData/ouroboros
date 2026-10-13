import { ConflictError } from "../../errors/error.envelope";
import type { LifecycleService } from "../../lifecycle/lifecycle.service";
import { PauseAllBinding } from "./pause-all.binding";
import { APP_URL, bindsOf, contextFor, INVOKER, strictDouble, WORKSPACE } from "./planes.fixture";

/**
 * `/ouro pause all confirm` (#537) is `LifecycleService.pause` — the call the Danger zone's
 * *Pause all loops* makes through `POST /api/v1/settings/lifecycle/pause`
 * (`LifecycleController.pause`: `this.lifecycle.pause(tenant.id, principal.user.id, body)`,
 * the body being `{ confirm: true }`). The dispatcher reaches this binding only once `confirm`
 * was typed. The double has `pause` and nothing else — no resume, no disconnect, no delete.
 */

/** The lifecycle as the service answers a pause. */
const PAUSED = {
  state: "paused",
  banner: {
    message: "All loops are paused. Nothing new starts until an owner or admin resumes.",
    actionLabel: "Resume",
    actionPath: "/settings#danger-zone",
  },
};

/** The invocation, with the `confirm` the registry requires. */
const CONTEXT = contextFor("pause all", { confirm: { type: "confirm" } });

describe("the /ouro pause all binding", () => {
  let pause: jest.Mock;
  let binding: PauseAllBinding;

  beforeEach(() => {
    pause = jest.fn().mockResolvedValue(PAUSED);
    binding = new PauseAllBinding(strictDouble<LifecycleService>("LifecycleService", { pause }));
  });

  it("serves the pause all command, which the registry binds to the lifecycle's pause route", () => {
    expect(binding.command).toBe("pause all");
    expect(bindsOf("pause all")).toBe("POST /api/v1/settings/lifecycle/pause");
  });

  it("pauses the workspace as the invoker, with the confirmation the service requires", async () => {
    await binding.run(CONTEXT);

    expect(pause).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledWith(WORKSPACE, INVOKER.userId, { confirm: true });
  });

  it("answers in the app-wide banner's own words, with where to resume", async () => {
    expect(await binding.run(CONTEXT)).toEqual({
      kind: "done",
      reply: {
        text: "All loops are paused. Nothing new starts until an owner or admin resumes.",
        link: { label: "Resume", url: `${APP_URL}/settings#danger-zone` },
      },
      ref: { state: "paused" },
    });
  });

  it("has a sentence of its own for a state the service gives no banner", async () => {
    pause.mockResolvedValue({ state: "paused", banner: null });

    expect(await binding.run(CONTEXT)).toEqual({
      kind: "done",
      reply: { text: "All loops are paused." },
      ref: { state: "paused" },
    });
  });

  it("relays workspace_state_conflict as the plane threw it", async () => {
    const refusal = new ConflictError(
      "workspace_state_conflict",
      "The workspace is already paused.",
    );
    pause.mockRejectedValue(refusal);

    await expect(binding.run(CONTEXT)).rejects.toBe(refusal);
  });
});
