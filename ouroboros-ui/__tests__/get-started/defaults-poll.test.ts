import { describe, expect, it, vi } from "vitest";

import { DEFAULTS_ENDPOINT, createDefaultsPoll, defaultsEndpoint, isOnboardingDefaults } from "@/app/get-started/defaults-poll";

import { REPO, genericTimeline, mergingDefaults, saasDefaults, selfHostedDefaults } from "../helpers/onboarding";

/** The right column's poll (#394): one endpoint per repository, and a guard on what comes back. */

describe("the right column's poll", () => {
  it("asks this origin, naming the repository", () => {
    expect(DEFAULTS_ENDPOINT).toBe("/api/onboarding/defaults");
    expect(defaultsEndpoint(REPO)).toBe("/api/onboarding/defaults?repo=acme-robotics%2Fhelios-firmware");
  });

  it("accepts the column — self-hosted, SaaS-flagged, one claim only, and a generic projection included", () => {
    expect(isOnboardingDefaults(selfHostedDefaults())).toBe(true);
    expect(isOnboardingDefaults(saasDefaults())).toBe(true);
    expect(isOnboardingDefaults(mergingDefaults())).toBe(true);
    expect(isOnboardingDefaults(selfHostedDefaults({ timeline: genericTimeline(), reassure: { claims: [], line: "" } }))).toBe(true);
  });

  it.each([
    ["nothing", null],
    ["a string", "column"],
    ["no deployment", { ...selfHostedDefaults(), deployment: undefined }],
    ["no rows", { ...selfHostedDefaults(), rows: null }],
    ["a row with no text", { ...selfHostedDefaults(), rows: [{ key: "models", variant: "bring_your_own_keys", status: "ready" }] }],
    ["a row whose link is a string", { ...selfHostedDefaults(), rows: [{ ...selfHostedDefaults().rows[0]!, link: "/models/providers" }] }],
    ["no claims", { ...selfHostedDefaults(), reassure: { line: "" } }],
    ["a claim with no mechanism", { ...selfHostedDefaults(), reassure: { claims: [{ key: "vault", text: "Sealed." }], line: "Sealed." } }],
    ["no timeline", { ...selfHostedDefaults(), timeline: null }],
    ["a timeline row with no kind", { ...selfHostedDefaults(), timeline: { ...selfHostedDefaults().timeline, rows: [{ key: "merge", actor: "you", text: "merge" }] } }],
  ])("refuses %s", (_label, value) => {
    expect(isOnboardingDefaults(value)).toBe(false);
  });

  it("reads its own endpoint", async () => {
    const read = vi.fn().mockResolvedValue({ state: "fresh", payload: selfHostedDefaults(), etag: null, pollAfterSeconds: null });
    const poll = createDefaultsPoll(defaultsEndpoint(REPO), { read, visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(selfHostedDefaults()));
    stop();

    expect(read).toHaveBeenCalledWith(defaultsEndpoint(REPO), null);
  });
});
