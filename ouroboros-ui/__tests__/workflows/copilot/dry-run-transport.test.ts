import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DryRunStreamEvent } from "@/app/workflows/copilot/dry-run";
import {
  FOLLOW_POLL_MS,
  type FollowMessage,
  type FollowSource,
  UNREACHABLE_DRY_RUN,
  UNREADABLE_DRY_RUN,
  asDryRun,
  createDryRunTransport,
  dryRunUrl,
  dryRunsUrl,
  followDryRun,
  readFollowEvent,
  suggestionUrl,
} from "@/app/workflows/copilot/dry-run-transport";

import {
  DRY_RUN_ID,
  SECURITY_PATCH_ID,
  SESSION_ID,
  SUGGESTION_SKIP_ID,
  TICKET_489_ID,
  dryRunCandidate,
  runningDryRun,
  seededDryRun,
  seededExplanation,
  seededStages,
  seededSuggestions,
} from "../../helpers/workflow-copilot";

/**
 * How the dry-run card reaches the service from the browser (CE.4, #568): each call asks this
 * origin's route and answers a value or **a refusal as a value**; and a run in flight is followed
 * over server-sent events, falling back to reading it every three seconds when there is no
 * `EventSource` or the stream drops.
 */

const RUNS = `/api/workflows/${SECURITY_PATCH_ID}/dry-runs`;

/** A fetch answering one response, remembering what it was asked. */
function answering(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(() => Promise.resolve(Response.json(body, { status })));
}

describe("this origin's routes", () => {
  it("are named under the workflow's dry runs, every id encoded", () => {
    expect(dryRunsUrl(SECURITY_PATCH_ID)).toBe(RUNS);
    expect(dryRunUrl(SECURITY_PATCH_ID, DRY_RUN_ID)).toBe(`${RUNS}/${DRY_RUN_ID}`);
    expect(dryRunUrl(SECURITY_PATCH_ID, DRY_RUN_ID, "events")).toBe(`${RUNS}/${DRY_RUN_ID}/events`);
    expect(suggestionUrl(SECURITY_PATCH_ID, DRY_RUN_ID, SUGGESTION_SKIP_ID, "explanation")).toBe(
      `${RUNS}/${DRY_RUN_ID}/suggestions/${SUGGESTION_SKIP_ID}/explanation`,
    );
    expect(dryRunUrl("a/b", "c d")).toBe("/api/workflows/a%2Fb/dry-runs/c%20d");
  });
});

describe("the reads", () => {
  it("read a run, its suggestions, the candidates and an explanation with GETs that are never cached", async () => {
    const cases = [
      [answering(seededDryRun()), (t: ReturnType<typeof createDryRunTransport>) => t.detail(SECURITY_PATCH_ID, DRY_RUN_ID), `${RUNS}/${DRY_RUN_ID}`],
      [
        answering({ dryRunId: DRY_RUN_ID, suggestions: seededSuggestions() }),
        (t: ReturnType<typeof createDryRunTransport>) => t.suggestions(SECURITY_PATCH_ID, DRY_RUN_ID),
        `${RUNS}/${DRY_RUN_ID}/suggestions`,
      ],
      [
        answering({ draftLabel: "v0.3", candidates: [dryRunCandidate()] }),
        (t: ReturnType<typeof createDryRunTransport>) => t.candidates(SECURITY_PATCH_ID),
        `${RUNS}/candidates`,
      ],
      [
        answering(seededExplanation()),
        (t: ReturnType<typeof createDryRunTransport>) => t.explanation(SECURITY_PATCH_ID, DRY_RUN_ID, SUGGESTION_SKIP_ID),
        `${RUNS}/${DRY_RUN_ID}/suggestions/${SUGGESTION_SKIP_ID}/explanation`,
      ],
    ] as const;

    for (const [fetcher, call, url] of cases) {
      const outcome = await call(createDryRunTransport(fetcher));

      expect(outcome.ok).toBe(true);
      expect(fetcher.mock.calls[0][0]).toBe(url);
      expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin" });
      expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
    }
  });

  it("unwrap the lists the service wraps", async () => {
    const suggestions = await createDryRunTransport(answering({ dryRunId: DRY_RUN_ID, suggestions: seededSuggestions() })).suggestions(
      SECURITY_PATCH_ID,
      DRY_RUN_ID,
    );
    const candidates = await createDryRunTransport(answering({ draftLabel: "v0.3", candidates: [dryRunCandidate()] })).candidates(
      SECURITY_PATCH_ID,
    );

    expect(suggestions).toEqual({ ok: true, value: seededSuggestions() });
    expect(candidates).toEqual({ ok: true, value: [dryRunCandidate()] });
  });
});

describe("the writes", () => {
  it("start a run with the ticket, the draft revision and the session, as a POST", async () => {
    const fetcher = answering(runningDryRun(), 201);
    const body = { ticketId: TICKET_489_ID, draftRev: 3, sessionId: SESSION_ID };

    const outcome = await createDryRunTransport(fetcher).start(SECURITY_PATCH_ID, body);

    expect(outcome).toEqual({ ok: true, value: runningDryRun() });
    expect(fetcher.mock.calls[0][0]).toBe(RUNS);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify(body) });
  });

  it("cancel, re-run, apply and ignore at their own routes", async () => {
    const cancelled = answering(seededDryRun({ status: "cancelled" }));
    const rerun = answering(runningDryRun(), 201);
    const applied = answering({ suggestion: seededSuggestions()[0], draftRev: 4, draftLabel: "v0.4", etag: "e" });
    const ignored = answering({ ...seededSuggestions()[0], status: "ignored" });

    await createDryRunTransport(cancelled).cancel(SECURITY_PATCH_ID, DRY_RUN_ID);
    await createDryRunTransport(rerun).rerun(SECURITY_PATCH_ID, DRY_RUN_ID);
    const apply = await createDryRunTransport(applied).apply(SECURITY_PATCH_ID, DRY_RUN_ID, SUGGESTION_SKIP_ID);
    const ignore = await createDryRunTransport(ignored).ignore(SECURITY_PATCH_ID, DRY_RUN_ID, SUGGESTION_SKIP_ID);

    expect(cancelled.mock.calls[0][0]).toBe(`${RUNS}/${DRY_RUN_ID}/cancel`);
    expect(rerun.mock.calls[0][0]).toBe(`${RUNS}/${DRY_RUN_ID}/rerun`);
    expect(applied.mock.calls[0][0]).toBe(`${RUNS}/${DRY_RUN_ID}/suggestions/${SUGGESTION_SKIP_ID}/apply`);
    expect(ignored.mock.calls[0][0]).toBe(`${RUNS}/${DRY_RUN_ID}/suggestions/${SUGGESTION_SKIP_ID}/ignore`);
    for (const fetcher of [cancelled, rerun, applied, ignored]) expect(fetcher.mock.calls[0][1]?.method).toBe("POST");
    expect(apply).toMatchObject({ ok: true, value: { draftLabel: "v0.4" } });
    expect(ignore).toMatchObject({ ok: true, value: { status: "ignored" } });
  });
});

describe("a refusal is a value", () => {
  it("carries the service's status, code and sentence", async () => {
    const envelope = { code: "dry_run_in_progress", message: "This workflow already has a dry run in progress.", details: {} };

    const outcome = await createDryRunTransport(answering(envelope, 409)).start(SECURITY_PATCH_ID, { ticketId: TICKET_489_ID, draftRev: 3 });

    expect(outcome).toEqual({ ok: false, refusal: { status: 409, code: envelope.code, message: envelope.message } });
  });

  it("says the service could not be reached when the request never got an answer", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("offline")));

    const outcome = await createDryRunTransport(fetcher).rerun(SECURITY_PATCH_ID, DRY_RUN_ID);

    expect(outcome).toMatchObject({ ok: false, refusal: { status: 0, message: UNREACHABLE_DRY_RUN } });
  });

  it("refuses an answer it cannot read rather than handing on a shape the card would trip over", async () => {
    const outcome = await createDryRunTransport(answering({ nothing: "like a run" })).detail(SECURITY_PATCH_ID, DRY_RUN_ID);
    const notJson = await createDryRunTransport(vi.fn<typeof fetch>(() => Promise.resolve(new Response("<html>")))).candidates(
      SECURITY_PATCH_ID,
    );

    expect(outcome).toMatchObject({ ok: false, refusal: { message: UNREADABLE_DRY_RUN } });
    expect(notJson).toMatchObject({ ok: false, refusal: { message: UNREADABLE_DRY_RUN } });
    expect(asDryRun(null)).toBeNull();
    expect(asDryRun([])).toBeNull();
  });
});

/** A fake `EventSource`: remembers its listeners and whether it was closed. */
function fakeSource() {
  const listeners = new Map<string, ((event: FollowMessage) => void)[]>();
  const source: FollowSource & { closed: boolean; url: string } = {
    closed: false,
    url: "",
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    close() {
      source.closed = true;
    },
  };

  return {
    source,
    open: (url: string) => {
      source.url = url;
      return source;
    },
    /** Deliver one of the service's events. */
    emit(event: DryRunStreamEvent) {
      for (const listener of listeners.get(event.kind) ?? []) listener({ data: JSON.stringify(event) });
    },
    /** Deliver a raw message under an event name. */
    raw(kind: string, message: FollowMessage) {
      for (const listener of listeners.get(kind) ?? []) listener(message);
    },
  };
}

/** Handlers that remember what they were told. */
function handlers() {
  return { onEvent: vi.fn(), onDetail: vi.fn(), onDropped: vi.fn(), onEnded: vi.fn() };
}

describe("reading the stream's events", () => {
  it("reads each of the five kinds, and nothing that is not one", () => {
    expect(readFollowEvent("stage_started", { data: '{"seq":4,"stageKey":"build","displayName":"build"}' })).toEqual({
      kind: "stage_started",
      seq: 4,
      stageKey: "build",
      displayName: "build",
    });
    expect(readFollowEvent("guard_blocked", { data: '{"guard":"allow_list","call":"git push","stageKey":"implement"}' })).toMatchObject({
      kind: "guard_blocked",
      call: "git push",
    });
    expect(readFollowEvent("done", { data: JSON.stringify({ dryRun: seededDryRun() }) })).toMatchObject({ kind: "done" });
    expect(readFollowEvent("stage_finished", { data: JSON.stringify({ stage: seededStages()[3] }) })).toMatchObject({
      kind: "stage_finished",
      stage: { stageKey: "build" },
    });

    expect(readFollowEvent("done", {})).toBeNull();
    expect(readFollowEvent("done", { data: "not json" })).toBeNull();
    expect(readFollowEvent("done", { data: '{"dryRun":{}}' })).toBeNull();
    expect(readFollowEvent("stage_started", { data: '{"seq":"4"}' })).toBeNull();
    expect(readFollowEvent("delta", { data: "{}" })).toBeNull();
  });
});

describe("following a run", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens this origin's stream and hands on each event, in order", () => {
    const fake = fakeSource();
    const told = handlers();

    followDryRun(SECURITY_PATCH_ID, DRY_RUN_ID, told, { open: fake.open, read: vi.fn() });
    fake.emit({ kind: "stage_started", seq: 4, stageKey: "build", displayName: "build" });
    fake.emit({ kind: "stage_finished", stage: seededStages()[3] });

    expect(fake.source.url).toBe(`${RUNS}/${DRY_RUN_ID}/events`);
    expect(told.onEvent.mock.calls.map(([event]) => event.kind)).toEqual(["stage_started", "stage_finished"]);
    expect(told.onEnded).not.toHaveBeenCalled();
    expect(fake.source.closed).toBe(false);
  });

  it("closes the source on `done` — an EventSource would reconnect and be told `done` for ever", () => {
    const fake = fakeSource();
    const told = handlers();

    followDryRun(SECURITY_PATCH_ID, DRY_RUN_ID, told, { open: fake.open, read: vi.fn() });
    fake.emit({ kind: "done", dryRun: seededDryRun() });
    fake.emit({ kind: "done", dryRun: seededDryRun() });

    expect(fake.source.closed).toBe(true);
    expect(told.onEvent).toHaveBeenCalledOnce();
    expect(told.onEnded).toHaveBeenCalledOnce();
  });

  it("skips a frame it cannot read and keeps following", () => {
    const fake = fakeSource();
    const told = handlers();

    followDryRun(SECURITY_PATCH_ID, DRY_RUN_ID, told, { open: fake.open, read: vi.fn() });
    fake.raw("stage_started", { data: "{" });
    fake.emit({ kind: "stage_started", seq: 4, stageKey: "build", displayName: "build" });

    expect(told.onEvent).toHaveBeenCalledOnce();
  });

  it("polls the run every three seconds when the stream drops, until a reading says it ended", async () => {
    const fake = fakeSource();
    const told = handlers();
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: runningDryRun() })
      .mockResolvedValueOnce({ ok: false, refusal: { status: 502, code: "x", message: "x" } })
      .mockResolvedValue({ ok: true, value: seededDryRun() });

    followDryRun(SECURITY_PATCH_ID, DRY_RUN_ID, told, { open: fake.open, read });
    fake.raw("error", {});

    expect(fake.source.closed).toBe(true);
    expect(told.onDropped).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(FOLLOW_POLL_MS);
    expect(read).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, DRY_RUN_ID);
    expect(told.onDetail).toHaveBeenCalledOnce();
    expect(told.onEnded).not.toHaveBeenCalled();

    // A refused reading is skipped; the next interval asks again.
    await vi.advanceTimersByTimeAsync(FOLLOW_POLL_MS);
    expect(told.onDetail).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(FOLLOW_POLL_MS);
    expect(told.onDetail).toHaveBeenCalledTimes(2);
    expect(told.onEnded).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(FOLLOW_POLL_MS * 3);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("polls from the start where the runtime has no EventSource", async () => {
    const told = handlers();
    const read = vi.fn().mockResolvedValue({ ok: true, value: seededDryRun() });

    followDryRun(SECURITY_PATCH_ID, DRY_RUN_ID, told, { open: () => null, read, intervalMs: 500 });
    expect(told.onDropped).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(500);
    expect(told.onEnded).toHaveBeenCalledOnce();
  });

  it("starts one poll however often the connection errors, and never two reads at once", async () => {
    const fake = fakeSource();
    const told = handlers();
    let release: (value: unknown) => void = () => {};
    const read = vi.fn(() => new Promise((resolve) => (release = resolve)));

    followDryRun(SECURITY_PATCH_ID, DRY_RUN_ID, told, { open: fake.open, read: read as never });
    fake.raw("error", {});
    fake.raw("error", {});
    await vi.advanceTimersByTimeAsync(FOLLOW_POLL_MS * 3);

    expect(told.onDropped).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
    release({ ok: true, value: runningDryRun() });
  });

  it("stops when told: the source closes, the poll ends, and nothing more is handed on", async () => {
    const fake = fakeSource();
    const told = handlers();
    const read = vi.fn().mockResolvedValue({ ok: true, value: runningDryRun() });

    const stop = followDryRun(SECURITY_PATCH_ID, DRY_RUN_ID, told, { open: fake.open, read });
    stop();
    stop();
    fake.emit({ kind: "done", dryRun: seededDryRun() });
    fake.raw("error", {});
    await vi.advanceTimersByTimeAsync(FOLLOW_POLL_MS * 2);

    expect(fake.source.closed).toBe(true);
    expect(told.onEvent).not.toHaveBeenCalled();
    expect(told.onEnded).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});
