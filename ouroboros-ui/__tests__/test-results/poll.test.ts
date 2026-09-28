import { afterEach, describe, expect, it, vi } from "vitest";

import {
  UNREADABLE_FAILURE,
  UNREADABLE_GATE,
  UNREADABLE_HINTS,
  UNREADABLE_PAGE,
  UNREADABLE_TIMELINE,
  createFailurePoll,
  createGatePoll,
  createHintsPoll,
  createPagePoll,
  createTimelinePoll,
  failureKey,
  failureKeyParts,
  failureUrl,
  gateUrl,
  hintsUrl,
  isCaseFailure,
  isRerunAvailability,
  isTestRunHints,
  isTestRunPage,
  isTestRunTimeline,
  pageUrl,
  timelineUrl,
} from "@/app/test-results/poll";

import { SEEDED_RUN_ID } from "../helpers/runs";
import {
  BUILD_3_ID,
  OVERSHOOT_CASE,
  caseFailure,
  caseHint,
  gate,
  hints,
  modelHint,
  page,
  suite,
  timeline,
} from "../helpers/test-results";

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

  it("name a case's failure and an attempt's hints, with every id encoded (#339)", () => {
    expect(failureUrl(BUILD_3_ID, OVERSHOOT_CASE.caseId)).toBe(
      `/api/test-runs/${BUILD_3_ID}/cases/${OVERSHOOT_CASE.caseId}/failure`,
    );
    expect(failureUrl("a/b", "c/../d")).toBe("/api/test-runs/a%2Fb/cases/c%2F..%2Fd/failure");
    expect(hintsUrl(BUILD_3_ID)).toBe(`/api/test-runs/${BUILD_3_ID}/hints`);
    expect(hintsUrl("a/../b")).toBe("/api/test-runs/a%2F..%2Fb/hints");
  });
});

describe("the failure's key (#339)", () => {
  it("carries the attempt and the case, and reads back as both", () => {
    const key = failureKey(BUILD_3_ID, OVERSHOOT_CASE.caseId);

    expect(failureKeyParts(key)).toEqual({ testRunId: BUILD_3_ID, caseId: OVERSHOOT_CASE.caseId });
    expect(failureKey(BUILD_3_ID, "a")).not.toBe(failureKey(BUILD_3_ID, "b"));
  });

  it("reads a key that names no case as no case", () => {
    expect(failureKeyParts(BUILD_3_ID)).toEqual({ testRunId: BUILD_3_ID, caseId: "" });
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

describe("the failure's and the hints' guards (#339)", () => {
  it("accept a failure, with or without its optional texts, and refuse what is not one", () => {
    expect(isCaseFailure(caseFailure())).toBe(true);
    expect(isCaseFailure(caseFailure({ path: null, message: null, logExcerpt: null, classname: null }))).toBe(true);
    expect(isCaseFailure({ ...caseFailure(), logExcerpt: 12 })).toBe(false);
    expect(isCaseFailure({ ...caseFailure(), path: undefined })).toBe(false);
    expect(isCaseFailure({ ...caseFailure(), caseId: null })).toBe(false);
    expect(isCaseFailure(hints())).toBe(false);
    expect(isCaseFailure(null)).toBe(false);
  });

  it("accept hints — heuristic, model, or none — and refuse what is not them", () => {
    expect(isTestRunHints(hints())).toBe(true);
    expect(isTestRunHints(hints([]))).toBe(true);
    expect(isTestRunHints(hints([modelHint(), caseHint({ hint: null, triage: null })]))).toBe(true);
    expect(isTestRunHints({ ...hints(), cases: [{ ...caseHint(), hint: "product_bug" }] })).toBe(false);
    expect(isTestRunHints({ ...hints(), cases: [{ ...caseHint(), triage: undefined }] })).toBe(false);
    expect(isTestRunHints({ ...hints(), cases: [null] })).toBe(false);
    expect(isTestRunHints({ testRunId: BUILD_3_ID })).toBe(false);
    expect(isTestRunHints(caseFailure())).toBe(false);
    expect(isTestRunHints(null)).toBe(false);
  });
});

describe("the reads", () => {
  it("ask this origin for a case's failure, and refuse a body that is not one (#339)", async () => {
    const stub = fetching(caseFailure());
    const poll = createFailurePoll(failureKey(BUILD_3_ID, OVERSHOOT_CASE.caseId), { visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(caseFailure()));
    expect(stub.mock.calls[0]![0]).toBe(failureUrl(BUILD_3_ID, OVERSHOOT_CASE.caseId));
    stop();

    fetching(page());
    const broken = createFailurePoll(failureKey(BUILD_3_ID, OVERSHOOT_CASE.caseId), { visible: () => true });
    const stopBroken = broken.start();
    await vi.waitFor(() => expect(broken.snapshot().error).toBe(UNREADABLE_FAILURE));
    stopBroken();
  });

  it("ask this origin for the attempt's hints, and refuse a body that is not them (#339)", async () => {
    const stub = fetching(hints());
    const poll = createHintsPoll(BUILD_3_ID, { visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(hints()));
    expect(stub.mock.calls[0]![0]).toBe(hintsUrl(BUILD_3_ID));
    stop();

    fetching(gate());
    const broken = createHintsPoll(BUILD_3_ID, { visible: () => true });
    const stopBroken = broken.start();
    await vi.waitFor(() => expect(broken.snapshot().error).toBe(UNREADABLE_HINTS));
    stopBroken();
  });

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
