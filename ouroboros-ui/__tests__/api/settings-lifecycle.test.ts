import { describe, expect, it, vi } from "vitest";

import { NAME_MISMATCH } from "@/app/lifecycle/danger";

import { clientAnswering } from "../helpers/api";
import { disconnectPreview, lifecycle, pausedLifecycle, pendingDeleteLifecycle } from "../helpers/lifecycle";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { NAME_MISMATCH_CODE, PENDING_DELETE_CODE, STATE_CONFLICT_CODE, settingsLifecycle } = await import(
  "@/app/api/settings-lifecycle"
);

/**
 * The workspace lifecycle's operations (#496 over #489): each reads or writes its own route
 * under `/api/v1/settings/lifecycle`, and the two confirmed moves carry their explicit yes.
 */

/**
 * The method and path of the one request a call made.
 *
 * @param requests The requests the stub saw.
 * @returns `METHOD /path`.
 */
function sent(requests: Request[]): string {
  expect(requests).toHaveLength(1);
  return `${requests[0].method} ${new URL(requests[0].url).pathname}`;
}

describe("settingsLifecycle", () => {
  it("reads where the workspace stands", async () => {
    const { client, requests } = clientAnswering(pausedLifecycle());

    expect(await settingsLifecycle.read(client)).toEqual(pausedLifecycle());
    expect(sent(requests)).toBe("GET /api/v1/settings/lifecycle");
  });

  it("pauses with the explicit confirmation the service requires", async () => {
    const { client, requests } = clientAnswering(pausedLifecycle());

    expect(await settingsLifecycle.pause(client)).toEqual(pausedLifecycle());
    expect(sent(requests)).toBe("POST /api/v1/settings/lifecycle/pause");
    expect(await requests[0].json()).toEqual({ confirm: true });
  });

  it("resumes with no body", async () => {
    const { client, requests } = clientAnswering(lifecycle());

    expect(await settingsLifecycle.resume(client)).toEqual(lifecycle());
    expect(sent(requests)).toBe("POST /api/v1/settings/lifecycle/resume");
    expect(await requests[0].text()).toBe("");
  });

  it("reads the disconnect preview", async () => {
    const { client, requests } = clientAnswering(disconnectPreview());

    expect(await settingsLifecycle.disconnectPreview(client)).toEqual(disconnectPreview());
    expect(sent(requests)).toBe("GET /api/v1/settings/lifecycle/disconnect-preview");
  });

  it("disconnects with the explicit confirmation, and answers the counts as they stood", async () => {
    const { client, requests } = clientAnswering(disconnectPreview({ activeRuns: 1 }));

    expect(await settingsLifecycle.disconnect(client)).toEqual(disconnectPreview({ activeRuns: 1 }));
    expect(sent(requests)).toBe("POST /api/v1/settings/lifecycle/disconnect");
    expect(await requests[0].json()).toEqual({ confirm: true });
  });

  it("deletes with the typed name alone until a step-up is supplied", async () => {
    const { client, requests } = clientAnswering(pendingDeleteLifecycle());

    expect(await settingsLifecycle.remove("acme-robotics", undefined, client)).toEqual(
      pendingDeleteLifecycle(),
    );
    expect(sent(requests)).toBe("POST /api/v1/settings/lifecycle/delete");
    expect(await requests[0].json()).toEqual({ confirmName: "acme-robotics" });
  });

  it("sends the password with the name when it has one, and the name exactly as typed", async () => {
    const { client, requests } = clientAnswering(pendingDeleteLifecycle());

    await settingsLifecycle.remove(" Acme ", "hunter2", client);

    expect(await requests[0].json()).toEqual({ confirmName: " Acme ", password: "hunter2" });
  });

  it("restores with no body", async () => {
    const { client, requests } = clientAnswering(lifecycle());

    expect(await settingsLifecycle.restore(client)).toEqual(lifecycle());
    expect(sent(requests)).toBe("POST /api/v1/settings/lifecycle/restore");
  });

  it("rejects with the service's refusal, code included", async () => {
    const { client } = clientAnswering(
      { code: "workspace_state_conflict", message: "A workspace that is paused cannot be asked to pause." },
      409,
    );

    await expect(settingsLifecycle.pause(client)).rejects.toMatchObject({
      status: 409,
      code: STATE_CONFLICT_CODE,
    });
  });

  it("names the codes the surfaces branch on as the service spells them", () => {
    expect(PENDING_DELETE_CODE).toBe("workspace_pending_delete");
    expect(NAME_MISMATCH_CODE).toBe("workspace_name_mismatch");
    // The Client Component's copy of the code is the same string.
    expect(NAME_MISMATCH).toBe(NAME_MISMATCH_CODE);
  });
});
