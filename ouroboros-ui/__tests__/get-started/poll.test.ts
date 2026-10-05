import { describe, expect, it, vi } from "vitest";

import { ONBOARDING_ENDPOINT, createOnboardingPoll, isOnboarding, onboardingEndpoint } from "@/app/get-started/poll";

import { REPO, wizard } from "../helpers/onboarding";

/** The wizard's poll (#390): one endpoint per repository, and a guard on what comes back. */

describe("the wizard's poll", () => {
  it("asks this origin, naming the repository", () => {
    expect(ONBOARDING_ENDPOINT).toBe("/api/onboarding");
    expect(onboardingEndpoint(REPO)).toBe("/api/onboarding?repo=acme-robotics%2Fhelios-firmware");
  });

  it("accepts the wizard — the finished one included", () => {
    expect(isOnboarding(wizard())).toBe(true);
    expect(isOnboarding(wizard({ currentStep: null }))).toBe(true);
  });

  it.each([
    ["nothing", null],
    ["a string", "wizard"],
    ["no steps", { ...wizard(), steps: "four" }],
    ["a step with no status", { ...wizard(), steps: [{ step: 1, title: "Connect GitHub" }] }],
    ["a step that is not one", { ...wizard(), steps: [null] }],
    ["no repository", { ...wizard(), repo: 7 }],
    ["a current step that is not a number", { ...wizard(), currentStep: "3" }],
    ["no choices", { ...wizard(), choices: null }],
  ])("refuses %s", (_label, value) => {
    expect(isOnboarding(value)).toBe(false);
  });

  it("reads its own endpoint", async () => {
    const read = vi.fn().mockResolvedValue({ state: "fresh", payload: wizard(), etag: null, pollAfterSeconds: null });
    const poll = createOnboardingPoll(onboardingEndpoint(REPO), { read, visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(wizard()));
    stop();

    expect(read).toHaveBeenCalledWith(onboardingEndpoint(REPO), null);
  });
});
