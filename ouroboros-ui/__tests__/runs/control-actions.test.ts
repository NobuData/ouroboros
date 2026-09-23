import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import {
  CONTROL_NOT_ALLOWED,
  CONTROL_NOT_ALLOWED_CODE,
  CONTROL_UNREACHABLE_CODE,
  STEER_INVALID,
  STEER_INVALID_CODE,
  SUBMIT_UNREACHABLE,
} from "@/app/runs/controls";

import { SEEDED_RUN_ID, runControl } from "../helpers/runs";

/**
 * The run controls' server hop (#310). The role gate and the typed confirmation are the
 * service's: this sends what it was given — only for the three head controls — and hands a
 * refusal back as a value the page can draw.
 */

const submitControl = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/runs", async (original) => ({
  ...(await original<typeof import("@/app/api/runs")>()),
  runs: { submitControl: (id: string, body: unknown) => submitControl(id, body) },
}));

const { submitRunControl } = await import("@/app/runs/control-actions");

beforeEach(() => {
  submitControl.mockReset();
});

describe("submitRunControl", () => {
  it("queues a pause with its key, and returns the control the queue holds", async () => {
    const queued = runControl({ kind: "pause" });
    submitControl.mockResolvedValue(queued);

    const outcome = await submitRunControl(SEEDED_RUN_ID, { kind: "pause", idempotencyKey: "k-1" });

    expect(submitControl).toHaveBeenCalledExactlyOnceWith(SEEDED_RUN_ID, { kind: "pause", idempotencyKey: "k-1" });
    expect(outcome).toEqual({ ok: true, control: queued });
  });

  it("queues a resume without a key when none was given", async () => {
    submitControl.mockResolvedValue(runControl({ kind: "resume" }));

    await submitRunControl(SEEDED_RUN_ID, { kind: "resume" });
    await submitRunControl(SEEDED_RUN_ID, { kind: "resume", idempotencyKey: "  " });

    expect(submitControl).toHaveBeenNthCalledWith(1, SEEDED_RUN_ID, { kind: "resume" });
    expect(submitControl).toHaveBeenNthCalledWith(2, SEEDED_RUN_ID, { kind: "resume" });
  });

  it("sends the abort's confirmation exactly as typed, for the service to judge", async () => {
    submitControl.mockResolvedValue(runControl({ kind: "abort" }));

    await submitRunControl(SEEDED_RUN_ID, { kind: "abort", confirmation: " #1847 " });

    expect(submitControl).toHaveBeenCalledExactlyOnceWith(SEEDED_RUN_ID, { kind: "abort", confirmation: " #1847 " });
  });

  it("never sends a confirmation on anything but an abort", async () => {
    submitControl.mockResolvedValue(runControl());

    await submitRunControl(SEEDED_RUN_ID, { kind: "pause", confirmation: "1847" } as never);

    expect(submitControl.mock.calls[0]![1]).toEqual({ kind: "pause" });
  });

  it("refuses any other kind before calling out", async () => {
    for (const kind of ["delete", "retry", undefined]) {
      const outcome = await submitRunControl(SEEDED_RUN_ID, { kind } as never);

      expect(outcome).toEqual({ ok: false, status: 422, code: CONTROL_NOT_ALLOWED_CODE, reason: CONTROL_NOT_ALLOWED });
    }
    expect(await submitRunControl(SEEDED_RUN_ID, null as never)).toMatchObject({ ok: false, code: CONTROL_NOT_ALLOWED_CODE });
    expect(submitControl).not.toHaveBeenCalled();
  });

  it("queues a steer with its text trimmed — what the service mirrors into the transcript (#312)", async () => {
    const queued = runControl({ kind: "steer", hasPayload: true });
    submitControl.mockResolvedValue(queued);

    const outcome = await submitRunControl(SEEDED_RUN_ID, {
      kind: "steer",
      payload: "  prefer a fix inside the ISR  ",
      idempotencyKey: "k-9",
    });

    expect(submitControl).toHaveBeenCalledExactlyOnceWith(SEEDED_RUN_ID, {
      kind: "steer",
      payload: "prefer a fix inside the ISR",
      idempotencyKey: "k-9",
    });
    expect(outcome).toEqual({ ok: true, control: queued });
  });

  it("refuses a steer with no text, or too much, before calling out", async () => {
    for (const payload of ["", "   ", "x".repeat(4097), 42, undefined]) {
      expect(await submitRunControl(SEEDED_RUN_ID, { kind: "steer", payload } as never)).toEqual({
        ok: false,
        status: 422,
        code: STEER_INVALID_CODE,
        reason: STEER_INVALID,
      });
    }
    expect(submitControl).not.toHaveBeenCalled();
  });

  it("never sends a payload on anything but a steer", async () => {
    submitControl.mockResolvedValue(runControl());

    await submitRunControl(SEEDED_RUN_ID, { kind: "pause", payload: "hello" } as never);

    expect(submitControl.mock.calls[0]![1]).toEqual({ kind: "pause" });
  });

  it("refuses a run id that is not a uuid before putting it in a path", async () => {
    for (const id of ["..", "../../queue", `${SEEDED_RUN_ID}/..`, ""]) {
      expect(await submitRunControl(id, { kind: "pause" })).toEqual({
        ok: false,
        status: 422,
        code: "validation_failed",
        reason: "That is not a run id.",
      });
    }
    expect(submitControl).not.toHaveBeenCalled();
  });

  it("hands a member's 403 back as a refusal", async () => {
    submitControl.mockRejectedValue(new ApiError(403, "forbidden", "Only an owner or admin may do that."));

    expect(await submitRunControl(SEEDED_RUN_ID, { kind: "abort", confirmation: "1847" })).toEqual({
      ok: false,
      status: 403,
      code: "forbidden",
      reason: "Only an owner or admin may do that.",
    });
  });

  it("hands a forged confirmation's 422 back in the service's words", async () => {
    submitControl.mockRejectedValue(
      new ApiError(422, "abort_confirmation_invalid", "Type the loop number to confirm the abort."),
    );

    expect(await submitRunControl(SEEDED_RUN_ID, { kind: "abort", confirmation: "9999" })).toEqual({
      ok: false,
      status: 422,
      code: "abort_confirmation_invalid",
      reason: "Type the loop number to confirm the abort.",
    });
  });

  it("says nothing was queued when the service could not be reached", async () => {
    submitControl.mockRejectedValue(new TypeError("fetch failed"));

    expect(await submitRunControl(SEEDED_RUN_ID, { kind: "pause" })).toEqual({
      ok: false,
      status: 502,
      code: CONTROL_UNREACHABLE_CODE,
      reason: SUBMIT_UNREACHABLE,
    });
  });

  it("lets anything else through — the redirect signal for an ended session above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    submitControl.mockRejectedValue(redirect);

    await expect(submitRunControl(SEEDED_RUN_ID, { kind: "pause" })).rejects.toBe(redirect);
  });
});
