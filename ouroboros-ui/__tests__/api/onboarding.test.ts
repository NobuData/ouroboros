import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_ONBOARDING } from "@/app/get-started/view";

import { STUB_BASE_URL, stubClient } from "../helpers/api";
import { REPO, launchReceipt, wizard } from "../helpers/onboarding";

/** The wizard's service calls (#385, #388) and the `/get-started` poll's hop (#390). */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { onboarding } = await import("@/app/api/onboarding");
const { ONBOARDING_REPO_MISSING, ONBOARDING_UNAVAILABLE_CODE, readOnboardingPoll } = await import(
  "@/app/api/onboarding-poll"
);

/** A client answering one body, recording what it was asked. */
function answering(body: unknown) {
  return stubClient(() => ({ body }));
}

/** Each request as `METHOD path?query`, and its body. */
async function asked(requests: Request[]) {
  return Promise.all(
    requests.map(async (request) => ({
      call: `${request.method} ${request.url.replace(STUB_BASE_URL, "")}`,
      body: request.method === "GET" ? null : await request.text(),
    })),
  );
}

describe("the wizard's service calls", () => {
  it("reads one repository's wizard, naming it in the query", async () => {
    const { client, requests } = answering(wizard());

    expect(await onboarding.read(REPO, client)).toEqual(wizard());
    expect(await asked(requests)).toEqual([
      { call: "GET /api/v1/onboarding?repo=acme-robotics%2Fhelios-firmware", body: null },
    ]);
  });

  it("reads the fresh-org rule with no repository", async () => {
    const { client, requests } = answering({ offer: true, reason: "fresh_organization" });

    expect(await onboarding.surfacing(client)).toEqual({ offer: true, reason: "fresh_organization" });
    expect((await asked(requests))[0]!.call).toBe("GET /api/v1/onboarding/surfacing");
  });

  it("dismisses, completes a step, skips and launches — each scoped to the repository", async () => {
    const { client, requests } = stubClient((request) => ({
      body: request.url.includes("skip")
        ? { onboarding: wizard(), settingsPath: "/settings", configurationImported: false }
        : request.url.includes("launch")
          ? launchReceipt()
          : wizard(),
    }));

    await onboarding.update(REPO, { dismissed: true }, client);
    await onboarding.completeStep(REPO, 3, client);
    expect((await onboarding.skip(REPO, client)).configurationImported).toBe(false);
    expect((await onboarding.launch(REPO, client)).outcome).toBe("queued");

    expect(await asked(requests)).toEqual([
      { call: "PATCH /api/v1/onboarding?repo=acme-robotics%2Fhelios-firmware", body: '{"dismissed":true}' },
      { call: "POST /api/v1/onboarding/complete-step?repo=acme-robotics%2Fhelios-firmware", body: '{"step":3}' },
      { call: "POST /api/v1/onboarding/skip?repo=acme-robotics%2Fhelios-firmware", body: "" },
      { call: "POST /api/v1/onboarding/launch?repo=acme-robotics%2Fhelios-firmware", body: "" },
    ]);
  });

  it("throws the service's refusal", async () => {
    const { client } = stubClient(() => ({
      status: 409,
      body: { code: "onboarding_step_incomplete", message: "No workflow has been created yet.", details: {} },
    }));

    await expect(onboarding.completeStep(REPO, 3, client)).rejects.toMatchObject({
      status: 409,
      message: "No workflow has been created yet.",
    });
  });
});

describe("readOnboardingPoll", () => {
  it("reads the repository with a deadline, and answers the wizard", async () => {
    const read = vi.fn().mockResolvedValue(wizard());

    expect(await readOnboardingPoll(REPO, read)).toEqual({
      state: "fresh",
      payload: wizard(),
      etag: null,
      pollAfterSeconds: null,
    });
    expect(read.mock.calls[0]![0]).toBe(REPO);
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
  });

  it.each([null, undefined, "", "helios-firmware", "a/b/c"])(
    "never forwards %j — it is not a repository",
    async (repo) => {
      const read = vi.fn();

      expect(await readOnboardingPoll(repo, read)).toEqual({
        state: "failed",
        reason: ONBOARDING_REPO_MISSING,
        pollAfterSeconds: null,
      });
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("reads a 401 as gone and a dropped read as unreachable, under this hop's code", async () => {
    expect(await readOnboardingPoll(REPO, vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in.")))).toEqual({
      state: "gone",
    });
    expect(await readOnboardingPoll(REPO, vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toMatchObject({
      state: "failed",
      reason: UNREACHABLE_ONBOARDING,
    });
    expect(ONBOARDING_UNAVAILABLE_CODE).toBe("onboarding_unavailable");
  });
});
