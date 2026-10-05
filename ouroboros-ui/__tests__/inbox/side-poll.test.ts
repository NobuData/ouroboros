import { afterEach, describe, expect, it, vi } from "vitest";

import { INBOX_SIDE_ENDPOINT, createSidePoll, isInboxSide, requestSide } from "@/app/inbox/side-poll";
import { UNREACHABLE_SIDE, UNREADABLE_SIDE } from "@/app/inbox/side-view";

import { inboxSide, policyRow, seededChannels, seededPolicyCard } from "../helpers/inbox";

/** The side column's poll (BO.4, #469): one endpoint for both cards, and a guard on what comes back. */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("where the side column is asked for", () => {
  it("is this origin's route", () => {
    expect(INBOX_SIDE_ENDPOINT).toBe("/api/inbox/side");
  });
});

describe("what counts as the side column", () => {
  it("accepts the service's two answers together", () => {
    expect(isInboxSide(inboxSide())).toBe(true);
  });

  it("accepts a card with no rows and a deployment with no channels", () => {
    expect(isInboxSide(inboxSide({ policies: seededPolicyCard({ rows: [] }) }))).toBe(true);
    expect(isInboxSide(inboxSide({ channels: { channels: [] } }))).toBe(true);
  });

  it.each([
    ["nothing", null],
    ["a string", "side"],
    ["an empty object", {}],
    ["the channels alone", { channels: seededChannels() }],
    ["the policies alone", { policies: seededPolicyCard() }],
    ["channels that are not a list", { ...inboxSide(), channels: { channels: "four" } }],
    ["null channels", { ...inboxSide(), channels: null }],
    ["null policies", { ...inboxSide(), policies: null }],
    ["rows that are not a list", { ...inboxSide(), policies: { ...seededPolicyCard(), rows: 3 } }],
    ["a card without its caption", { ...inboxSide(), policies: { rows: [] } }],
    [
      "a channel without a state — a row whose standing would be a guess",
      { ...inboxSide(), channels: { channels: [{ id: "slack", label: "Slack", summary: "…" }] } },
    ],
    ["a channel that is not an object", { ...inboxSide(), channels: { channels: ["slack"] } }],
    [
      "a rule with nowhere to edit it",
      { ...inboxSide(), policies: { ...seededPolicyCard(), rows: [{ ...policyRow(), editHref: undefined }] } },
    ],
    ["a rule that is not an object", { ...inboxSide(), policies: { ...seededPolicyCard(), rows: [null] } }],
  ])("refuses %s", (_label, value) => {
    expect(isInboxSide(value)).toBe(false);
  });
});

describe("one read on this origin", () => {
  /** Answer the next fetch with a JSON body. */
  function answering(body: unknown, status = 200): ReturnType<typeof vi.fn> {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })),
    );

    vi.stubGlobal("fetch", fetch);

    return fetch;
  }

  it("asks the side route and answers what it sent", async () => {
    const fetch = answering(inboxSide());

    const answer = await requestSide(null);

    expect(String(fetch.mock.calls[0]![0])).toContain("/api/inbox/side");
    expect(answer).toMatchObject({ state: "fresh", payload: inboxSide() });
  });

  it("says unreadable for an answer that is not the side column", async () => {
    answering({ channels: [] });

    expect(await requestSide(null)).toMatchObject({ state: "failed", reason: UNREADABLE_SIDE });
  });

  it("says unreachable when nothing answers", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));

    expect(await requestSide(null)).toMatchObject({ state: "failed", reason: UNREACHABLE_SIDE });
  });
});

describe("the side column's poll", () => {
  it("reads through the reader it was given", async () => {
    const read = vi
      .fn()
      .mockResolvedValue({ state: "fresh", payload: inboxSide(), etag: null, pollAfterSeconds: null });
    const poll = createSidePoll({ read, visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(inboxSide()));
    stop();

    expect(read).toHaveBeenCalled();
  });
});
