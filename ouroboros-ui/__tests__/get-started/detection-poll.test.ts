import { describe, expect, it, vi } from "vitest";

import {
  DETECTION_ENDPOINT,
  createDetectionPoll,
  detectionEndpoint,
  isDetection,
} from "@/app/get-started/detection-poll";

import { REPO, scanProgress, seededCard } from "../helpers/onboarding";

/** The detection card's poll (#391): one endpoint per repository, and a guard on what comes back. */

describe("the detection card's poll", () => {
  it("asks this origin, naming the repository", () => {
    expect(DETECTION_ENDPOINT).toBe("/api/onboarding/detection");
    expect(detectionEndpoint(REPO)).toBe("/api/onboarding/detection?repo=acme-robotics%2Fhelios-firmware");
  });

  it("accepts the card — never scanned and mid-scan included", () => {
    expect(isDetection(seededCard())).toBe(true);
    expect(isDetection(seededCard({ scan: null, rows: [], protectedPaths: [] }))).toBe(true);
    expect(isDetection(seededCard({ progress: scanProgress() }))).toBe(true);
  });

  it.each([
    ["nothing", null],
    ["a string", "card"],
    ["no repository", { ...seededCard(), repo: 7 }],
    ["a scan with no number", { ...seededCard(), scan: { durationMs: 1 } }],
    ["rows that are not a list", { ...seededCard(), rows: {} }],
    ["a row with no value", { ...seededCard(), rows: [{ rowKey: "build", evidence: {} }] }],
    ["a row that is not one", { ...seededCard(), rows: [null] }],
    ["no protected paths", { ...seededCard(), protectedPaths: null }],
    ["progress with no state", { ...seededCard(), progress: {} }],
  ])("refuses %s", (_label, value) => {
    expect(isDetection(value)).toBe(false);
  });

  it("reads its own endpoint", async () => {
    const read = vi.fn().mockResolvedValue({ state: "fresh", payload: seededCard(), etag: null, pollAfterSeconds: null });
    const poll = createDetectionPoll(detectionEndpoint(REPO), { read, visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(seededCard()));
    stop();

    expect(read).toHaveBeenCalledWith(detectionEndpoint(REPO), null);
  });
});
