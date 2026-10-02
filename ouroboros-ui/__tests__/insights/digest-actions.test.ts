import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { MAIL_UNCONFIGURED, SUBSCRIBE_FAILED } from "@/app/insights/digest-view";

vi.mock("server-only", () => ({}));

const digest = vi.fn();
const digestPreview = vi.fn();
const subscribeDigest = vi.fn();

vi.mock("@/app/api/insights", () => ({
  insights: {
    digest: (...args: unknown[]) => digest(...args),
    digestPreview: (...args: unknown[]) => digestPreview(...args),
    subscribeDigest: (...args: unknown[]) => subscribeDigest(...args),
  },
}));

const { readDigestSheet, setDigestSubscription } = await import("@/app/insights/digest-actions");

/**
 * The digest sheet's Server Actions (#447): the digest and its preview are read independently,
 * a subscription change is the caller's own, and the service's refusals come back as sentences
 * while anything that is not one still throws.
 */

const DIGEST = {
  subscribed: false,
  recipient: "ada@example.com",
  schedule: { weeklyDay: 1, weeklyTime: "09:00", timezone: "UTC", nextRunAt: "2026-08-10T09:00:00.000Z" },
  mail: { transport: "smtp" },
};

beforeEach(() => {
  digest.mockReset();
  digestPreview.mockReset();
  subscribeDigest.mockReset();
});

describe("readDigestSheet", () => {
  it("reads the digest and its preview", async () => {
    digest.mockResolvedValue(DIGEST);
    digestPreview.mockResolvedValue({ subject: "s" });

    await expect(readDigestSheet()).resolves.toEqual({
      digest: { ok: true, value: DIGEST },
      preview: { ok: true, value: { subject: "s" } },
    });
  });

  it("keeps the digest when only the preview is refused", async () => {
    digest.mockResolvedValue(DIGEST);
    digestPreview.mockRejectedValue(new ApiError(500, "internal", "render failed"));

    const readings = await readDigestSheet();

    expect(readings.digest).toEqual({ ok: true, value: DIGEST });
    expect(readings.preview.ok).toBe(false);
  });
});

describe("setDigestSubscription", () => {
  it("opts the caller in and answers the digest as it now stands", async () => {
    subscribeDigest.mockResolvedValue({ ...DIGEST, subscribed: true });

    await expect(setDigestSubscription(true)).resolves.toEqual({ ok: true, value: { ...DIGEST, subscribed: true } });
    expect(subscribeDigest).toHaveBeenCalledWith(true);
  });

  it("opts the caller out — the unsubscribe path", async () => {
    subscribeDigest.mockResolvedValue(DIGEST);

    await setDigestSubscription(false);

    expect(subscribeDigest).toHaveBeenCalledWith(false);
  });

  it("says why a deployment with no mail server refused the opt-in", async () => {
    subscribeDigest.mockRejectedValue(new ApiError(409, "insights_digest_mail_unconfigured", "no mail"));

    await expect(setDigestSubscription(true)).resolves.toEqual({ ok: false, reason: MAIL_UNCONFIGURED });
  });

  it("says a refusal it does not know plainly", async () => {
    subscribeDigest.mockRejectedValue(new ApiError(422, "validation_failed", "bad"));

    await expect(setDigestSubscription(true)).resolves.toEqual({ ok: false, reason: SUBSCRIBE_FAILED });
  });

  it("refuses anything but a boolean without calling the service", async () => {
    await expect(setDigestSubscription("yes" as unknown as boolean)).resolves.toEqual({
      ok: false,
      reason: SUBSCRIBE_FAILED,
    });
    expect(subscribeDigest).not.toHaveBeenCalled();
  });

  it("lets what is not the service's refusal travel — a redirect above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    subscribeDigest.mockRejectedValue(redirect);

    await expect(setDigestSubscription(true)).rejects.toBe(redirect);
  });
});
