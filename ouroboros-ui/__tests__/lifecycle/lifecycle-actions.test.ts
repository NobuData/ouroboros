import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { LIFECYCLE_FAILED } from "@/app/lifecycle/outcome";

import { disconnectPreview, lifecycle, pausedLifecycle, pendingDeleteLifecycle } from "../helpers/lifecycle";

/**
 * The lifecycle's Server Actions (BS.6, #496): a refusal is a value carrying the service's
 * sentence and code, anything else keeps travelling, and a landed write re-reads the page —
 * except the delete, whose page is about to be frozen.
 */

vi.mock("server-only", () => ({}));

const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

const api = {
  read: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  disconnectPreview: vi.fn(),
  disconnect: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
};

vi.mock("@/app/api/settings-lifecycle", () => ({
  settingsLifecycle: {
    read: () => api.read(),
    pause: () => api.pause(),
    resume: () => api.resume(),
    disconnectPreview: () => api.disconnectPreview(),
    disconnect: () => api.disconnect(),
    remove: (name: string, password?: string) => api.remove(name, password),
    restore: () => api.restore(),
  },
}));

const actions = await import("@/app/lifecycle/lifecycle-actions");

beforeEach(() => {
  refresh.mockClear();
  for (const call of Object.values(api)) call.mockReset();
});

describe("the reads", () => {
  it("answer the lifecycle and re-read nothing", async () => {
    api.read.mockResolvedValue(pausedLifecycle());

    expect(await actions.readLifecycle()).toEqual({ ok: true, value: pausedLifecycle() });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("answer the disconnect preview and re-read nothing", async () => {
    api.disconnectPreview.mockResolvedValue(disconnectPreview());

    expect(await actions.readDisconnectPreview()).toEqual({ ok: true, value: disconnectPreview() });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("the writes that change what every page draws", () => {
  it.each([
    ["pauseWorkspace", "pause", pausedLifecycle()],
    ["resumeWorkspace", "resume", lifecycle()],
    ["disconnectWorkspace", "disconnect", disconnectPreview()],
    ["restoreWorkspace", "restore", lifecycle()],
  ] as const)("%s answers the service's value and re-reads the page", async (action, call, value) => {
    api[call].mockResolvedValue(value);

    expect(await actions[action]()).toEqual({ ok: true, value });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each([
    ["pauseWorkspace", "pause"],
    ["resumeWorkspace", "resume"],
    ["disconnectWorkspace", "disconnect"],
    ["restoreWorkspace", "restore"],
  ] as const)("%s keeps a refusal as a value, with its code, and re-reads nothing", async (action, call) => {
    api[call].mockRejectedValue(new ApiError(409, "workspace_state_conflict", "Not from here."));

    expect(await actions[action]()).toEqual({
      ok: false,
      reason: "Not from here.",
      code: "workspace_state_conflict",
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("the delete", () => {
  it("passes the name and the password through, and does not re-read a page about to be frozen", async () => {
    api.remove.mockResolvedValue(pendingDeleteLifecycle());

    expect(await actions.deleteWorkspace("acme-robotics", "hunter2")).toEqual({
      ok: true,
      value: pendingDeleteLifecycle(),
    });
    expect(api.remove).toHaveBeenCalledExactlyOnceWith("acme-robotics", "hunter2");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sends no password until one is given", async () => {
    api.remove.mockResolvedValue(pendingDeleteLifecycle());

    await actions.deleteWorkspace("acme-robotics");

    expect(api.remove).toHaveBeenCalledExactlyOnceWith("acme-robotics", undefined);
  });

  it("answers the step-up as a code the dialog can act on", async () => {
    api.remove.mockRejectedValue(new ApiError(403, "step_up_required", "Confirm it is you."));

    expect(await actions.deleteWorkspace("acme-robotics")).toEqual({
      ok: false,
      reason: "Confirm it is you.",
      code: "step_up_required",
    });
  });
});

describe("a refusal with no sentence, and a failure that is not a refusal", () => {
  it("says the fallback rather than nothing", async () => {
    api.pause.mockRejectedValue(new ApiError(500, "internal", ""));

    expect(await actions.pauseWorkspace()).toEqual({ ok: false, reason: LIFECYCLE_FAILED, code: "internal" });
  });

  it("lets a redirect to sign in keep travelling", async () => {
    api.resume.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));

    await expect(actions.resumeWorkspace()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(refresh).not.toHaveBeenCalled();
  });
});
