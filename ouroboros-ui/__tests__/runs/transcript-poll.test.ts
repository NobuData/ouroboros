import { afterEach, describe, expect, it, vi } from "vitest";

import {
  UNREACHABLE_TRANSCRIPT,
  UNREADABLE_TRANSCRIPT,
  eventsUrl,
  isRunEventsPage,
  requestEvents,
} from "@/app/runs/transcript-poll";

import { SEEDED_RUN_ID, eventsPage } from "../helpers/runs";

/** The transcript's reader (#312): the address, the guard, and the answers a read comes back as. */

/**
 * A `fetch` answering one response.
 *
 * @param body What to answer with.
 * @param status The status.
 * @returns The stub.
 */
function fetching(body: unknown, status = 200) {
  const stub = vi.fn<(url: string) => Promise<Response>>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })),
  );
  vi.stubGlobal("fetch", stub);
  return stub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("eventsUrl", () => {
  it("is this origin's, with the cursor, the id encoded", () => {
    expect(eventsUrl(SEEDED_RUN_ID, 0)).toBe(`/api/runs/${SEEDED_RUN_ID}/events?after=0`);
    expect(eventsUrl("a/b", 12)).toBe("/api/runs/a%2Fb/events?after=12");
  });
});

describe("isRunEventsPage", () => {
  it("accepts a page and refuses what merely answered", () => {
    expect(isRunEventsPage(eventsPage())).toBe(true);
    expect(isRunEventsPage(eventsPage({ entries: [] }))).toBe(true);
    expect(isRunEventsPage(null)).toBe(false);
    expect(isRunEventsPage([])).toBe(false);
    expect(isRunEventsPage({ ...eventsPage(), after: -1 })).toBe(false);
    expect(isRunEventsPage({ ...eventsPage(), live: "yes" })).toBe(false);
    expect(isRunEventsPage({ ...eventsPage(), entries: [{ seq: 1, actor: "plan" }] })).toBe(false);
  });
});

describe("requestEvents", () => {
  it("asks for the page after the cursor and answers fresh", async () => {
    const stub = fetching(eventsPage());

    expect(await requestEvents(SEEDED_RUN_ID, 4)).toMatchObject({ state: "fresh", payload: eventsPage() });
    expect(stub.mock.calls[0]![0]).toBe(eventsUrl(SEEDED_RUN_ID, 4));
  });

  it("says the transcript could not be read, or reached, in its own words", async () => {
    fetching({ nope: true });
    expect(await requestEvents("x", 0)).toMatchObject({ state: "failed", reason: UNREADABLE_TRANSCRIPT });

    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    expect(await requestEvents("x", 0)).toMatchObject({ state: "failed", reason: UNREACHABLE_TRANSCRIPT });
  });
});
