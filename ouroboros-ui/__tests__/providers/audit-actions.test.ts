import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import {
  AUDIT_FORBIDDEN,
  AUDIT_PAGE_SIZE,
  AUDIT_UNAVAILABLE,
} from "@/app/providers/view";

import { seededTrail, trailPayload } from "../helpers/audit";

/**
 * The trail sheet's one server hop
 * ([#225](https://github.com/NobuData/ouroboros/issues/225)).
 *
 * A Server Action is a POST endpoint anybody can reach, so every action suite in this module
 * is written as the security case first. Here it is short, and it is the whole argument for
 * the shape of this module: **the action takes no arguments at all.** There is no workspace
 * in the call and no person, so there is nothing to forge — the trail belongs to the
 * workspace the caller's own session is acting in, and the role gate is the service's.
 *
 * The rest of the suite is the posture: a refusal is a sentence the sheet can draw rather than
 * a rejection that would replace the page underneath it, and the gate's redirect is the one
 * throw that must travel.
 */

/** What the API answers, per case. */
const events = vi.fn();

vi.mock("@/app/api/audit", () => ({
  audit: { events: (filter: unknown) => events(filter) },
}));

const { readAuditTrail } = await import("@/app/providers/audit-actions");

beforeEach(() => {
  events.mockReset();
});

describe("reading the trail", () => {
  it("asks for the session's own workspace and names nothing else", async () => {
    // The security case: no workspace, no person, no filter a caller could aim somewhere.
    events.mockResolvedValue(trailPayload());

    await readAuditTrail();

    expect(events).toHaveBeenCalledTimes(1);
    expect(events.mock.calls[0][0]).toEqual({ limit: AUDIT_PAGE_SIZE });
  });

  it("hands back the page it read", async () => {
    events.mockResolvedValue(trailPayload());

    const reading = await readAuditTrail();

    expect(reading).toMatchObject({ ok: true, total: seededTrail().length });
    expect(reading.ok && reading.events).toHaveLength(seededTrail().length);
  });

  it("reads an empty workspace as an empty trail rather than as a failure", async () => {
    // *Nothing has happened yet* and *the trail could not be read* are different facts, and
    // the sheet says something different for each.
    events.mockResolvedValue(trailPayload([]));

    await expect(readAuditTrail()).resolves.toEqual({ ok: true, events: [], total: 0 });
  });

  it("answers a role that may not read it with the sentence that says who to ask", async () => {
    // The service's own `403` message is written for an API caller.
    events.mockRejectedValue(
      new ApiError(403, "forbidden", "Your role does not permit this.", {}),
    );

    await expect(readAuditTrail()).resolves.toEqual({ ok: false, reason: AUDIT_FORBIDDEN });
  });

  it("answers any other refusal with the sentence that says nothing was changed", async () => {
    events.mockRejectedValue(new ApiError(500, "internal_error", "Something failed.", {}));

    await expect(readAuditTrail()).resolves.toEqual({ ok: false, reason: AUDIT_UNAVAILABLE });
  });

  it("lets the gate's redirect travel", async () => {
    // A `401` reaches this layer as Next.js's redirect signal rather than as an `ApiError`,
    // and a `catch` wide enough to hold it would swallow the navigation to the login screen
    // and draw a sheet captioned with the framework's internal message.
    const redirect = new Error("NEXT_REDIRECT");

    events.mockRejectedValue(redirect);

    await expect(readAuditTrail()).rejects.toBe(redirect);
  });
});
