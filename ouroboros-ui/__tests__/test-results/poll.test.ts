import { afterEach, describe, expect, it, vi } from "vitest";

import {
  UNREADABLE_GATE,
  UNREADABLE_PAGE,
  UNREADABLE_TIMELINE,
  createGatePoll,
  createPagePoll,
  createTimelinePoll,
  gateUrl,
  isRerunAvailability,
  isTestRunPage,
  isTestRunTimeline,
  pageUrl,
  timelineUrl,
} from "@/app/test-results/poll";

import { SEEDED_RUN_ID } from "../helpers/runs";
import { BUILD_3_ID, gate, page, suite, timeline } from "../helpers/test-results";

/**
 * The test-results page's two poll readers (#335): the addresses, the guards, and a read through
 * `fetch`. The loop itself — cadence, visibility, `X-Ouro-Poll-After` — is `poll.test.ts`'s.
 */

/**
 * A `fetch` answering one response.
 *
 * @param body What to answer with, serialised as JSON.
 * @returns The stub.
 */
function fetching(body: unknown) {
  const stub = vi.fn((_url: string) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })),
  );
  vi.stubGlobal("fetch", stub);
  return stub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the addresses", () => {
  it("are this origin's, with the id encoded", () => {
    expect(timelineUrl(SEEDED_RUN_ID)).toBe(`/api/runs/${SEEDED_RUN_ID}/tests`);
    expect(gateUrl(BUILD_3_ID)).toBe(`/api/test-runs/${BUILD_3_ID}/rerun`);
    expect(timelineUrl("a/../b")).toBe("/api/runs/a%2F..%2Fb/tests");
    expect(pageUrl(BUILD_3_ID)).toBe(`/api/test-runs/${BUILD_3_ID}`);
    expect(pageUrl("a/../b")).toBe("/api/test-runs/a%2F..%2Fb");
  });
});

describe("the guards", () => {
  it("accept a timeline and a gate, and refuse what is not one", () => {
    expect(isTestRunTimeline(timeline())).toBe(true);
    expect(isTestRunTimeline(timeline({ attempts: [] }))).toBe(true);
    expect(isTestRunTimeline({ run: { loopSeq: 1 }, attempts: [{ id: "x" }] })).toBe(false);
    expect(isTestRunTimeline({ attempts: [] })).toBe(false);
    expect(isTestRunTimeline(null)).toBe(false);

    expect(isRerunAvailability(gate())).toBe(true);
    expect(isRerunAvailability({ ...gate(), failedCases: "1" })).toBe(false);
    expect(isRerunAvailability("gate")).toBe(false);
  });

  it("accept an attempt's page, and refuse one whose suites cannot be drawn (#337)", () => {
    expect(isTestRunPage(page())).toBe(true);
    expect(isTestRunPage(page({ suites: [] }))).toBe(true);
    expect(isTestRunPage({ ...page(), suites: undefined })).toBe(false);
    expect(isTestRunPage({ ...page(), testRun: null })).toBe(false);
    expect(isTestRunPage({ ...page(), suites: [{ ...suite(), counts: null }] })).toBe(false);
    expect(isTestRunPage({ ...page(), suites: [{ ...suite(), cases: "none" }] })).toBe(false);
    expect(isTestRunPage({ ...page(), suites: [null] })).toBe(false);
    expect(isTestRunPage(timeline())).toBe(false);
    expect(isTestRunPage(null)).toBe(false);
  });
});

describe("the reads", () => {
  it("ask this origin for the timeline, and refuse a body that is not one", async () => {
    const stub = fetching(timeline());
    const poll = createTimelinePoll(SEEDED_RUN_ID, { visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(timeline()));
    expect(stub.mock.calls[0]![0]).toBe(timelineUrl(SEEDED_RUN_ID));
    stop();

    fetching({ nope: true });
    const broken = createTimelinePoll(SEEDED_RUN_ID, { visible: () => true });
    const stopBroken = broken.start();
    await vi.waitFor(() => expect(broken.snapshot().error).toBe(UNREADABLE_TIMELINE));
    stopBroken();
  });

  it("ask this origin for the gate, and refuse a body that is not one", async () => {
    const stub = fetching(gate());
    const poll = createGatePoll(BUILD_3_ID, { visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(gate()));
    expect(stub.mock.calls[0]![0]).toBe(gateUrl(BUILD_3_ID));
    stop();

    fetching([]);
    const broken = createGatePoll(BUILD_3_ID, { visible: () => true });
    const stopBroken = broken.start();
    await vi.waitFor(() => expect(broken.snapshot().error).toBe(UNREADABLE_GATE));
    stopBroken();
  });

  it("ask this origin for the attempt's page, and refuse a body that is not one (#337)", async () => {
    const stub = fetching(page());
    const poll = createPagePoll(BUILD_3_ID, { visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(page()));
    expect(stub.mock.calls[0]![0]).toBe(pageUrl(BUILD_3_ID));
    stop();

    fetching(gate());
    const broken = createPagePoll(BUILD_3_ID, { visible: () => true });
    const stopBroken = broken.start();
    await vi.waitFor(() => expect(broken.snapshot().error).toBe(UNREADABLE_PAGE));
    stopBroken();
  });
});
