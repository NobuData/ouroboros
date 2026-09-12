import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TICKET_SOURCE_KINDS, TICKET_SOURCE_STATUSES } from "../db/schema";
import { FIXTURE_CREDENTIAL, FIXTURE_ENVELOPE } from "./ticket-source.fixture";
import {
  MAX_STATUS_REASON,
  TICKET_SOURCE_ERROR_CLASSES,
  TICKET_SOURCE_ERROR_REASONS,
  TICKET_SOURCE_ERROR_RETRYABLE,
  TICKET_SOURCE_ERROR_STATUS,
  TicketSourceError,
  classifyHttpStatus,
  formatClock,
  statusReasonFor,
} from "./ticket-source.errors";

/**
 * Q.2's second acceptance criterion: **provider errors map to source status with honest
 * UI-facing reasons (`rate limited until 14:20`, not `error`)**
 * ([#139](https://github.com/NobuData/ouroboros/issues/139)).
 *
 * Four things are worth checking here and the rest is a lookup table. That the taxonomy is
 * **provider-neutral** — asserted over the file's own source, because a vendor name in a
 * phrase is the failure this module exists to prevent and it is not visible from any call.
 * That the phrases are **distinct**, because four classes that render the same sentence are one
 * class with three aliases. That a rate limit really says **when**. And that no branch can
 * produce a value `ticket_sources_status_reason_present` would refuse, because the writer is a
 * background loop and a `23514` there is a red source nobody can explain.
 */

/**
 * The taxonomy's own source, with two things removed before it is searched.
 *
 * **Its header comment**, because the header names all five trackers deliberately: the five
 * ways one failure arrives is the argument for having one word for it. What must contain no
 * tracker is everything the argument produced — the phrases, the branches, and the comments
 * beside them — so the header is cut off rather than exempted by a list of allowed words that
 * would have to be maintained.
 *
 * **This repository's own issue links**, because they are served from github.com and every
 * file here carries several. A test that could not tell *the tracker this product syncs from*
 * apart from *the tracker this product is developed on* would be a test that failed on a
 * citation, and the fix for it would be to stop citing.
 */
const SOURCE = readFileSync(join(__dirname, "ticket-source.errors.ts"), "utf8")
  .slice(readFileSync(join(__dirname, "ticket-source.errors.ts"), "utf8").indexOf("*/") + 2)
  .replaceAll(/https:\/\/github\.com\/NobuData\/\S*/g, "");

/**
 * One error of each class, with the extras that class can carry.
 *
 * @param overrides - What differs.
 * @returns The error.
 */
function errorOf(
  errorClass: (typeof TICKET_SOURCE_ERROR_CLASSES)[number],
  retryAt: Date | null = null,
  httpStatus: number | null = null,
): TicketSourceError {
  return new TicketSourceError(errorClass, "detail the provider wrote", retryAt, httpStatus);
}

describe("the ticket source error taxonomy", () => {
  it("names no tracker below its header", () => {
    // The claim the whole module rests on, and one a reviewer would otherwise have to make by
    // reading. Checked against the source rather than against the exported values, because a
    // tracker's name would just as likely arrive in a comment beside a branch — and the next
    // person to widen that branch reads the comment.
    //
    // The five kinds are the vocabulary V030 stores, so their absence here is exactly the
    // statement that the *taxonomy* is neutral while the *column* is not.
    for (const kind of TICKET_SOURCE_KINDS) {
      if (kind === "custom") {
        // Not a tracker's name — it is V030's word for "somebody else's provider".
        continue;
      }

      expect(SOURCE.toLowerCase()).not.toContain(kind);
    }

    for (const vendor of ["atlassian", "octokit", "acme"]) {
      expect(SOURCE.toLowerCase()).not.toContain(vendor);
    }
  });

  it("composes only from its own phrases, so a provider's words cannot reach the column", () => {
    // The structural half of the credential claim below: `statusReasonFor` does not mention
    // `detail` at all, which is what makes "a tracker's error body cannot reach a settings
    // page" a property of the function rather than of every provider's care.
    const composer = SOURCE.slice(SOURCE.indexOf("export function statusReasonFor"));
    const body = composer.slice(0, composer.indexOf("\n}"));

    expect(body).not.toContain("detail");
  });

  it("is four classes wide, and the list matches the type", () => {
    // `satisfies` already holds the list to the union at compile time; what this adds is the
    // other direction — a class added to the union and forgotten here would compile, and every
    // total record below would then be missing an entry the compiler *would* catch. So this is
    // really an assertion that the three records below are exhaustive of something.
    expect([...TICKET_SOURCE_ERROR_CLASSES]).toStrictEqual([
      "auth",
      "rate_limit",
      "not_found",
      "upstream",
    ]);
  });

  it.each(TICKET_SOURCE_ERROR_CLASSES)("maps %s onto a real source status", (errorClass) => {
    // The coarsening is a decision rather than an absence — see the file's header — so what is
    // asserted is that the value is one V030's CHECK accepts, not that it is `error`. If that
    // column ever grows a fourth state, this test keeps passing and the table below is where
    // the decision gets made.
    expect(TICKET_SOURCE_STATUSES).toContain(TICKET_SOURCE_ERROR_STATUS[errorClass]);
  });

  it("coarsens every class to error, which is why the reason column exists", () => {
    const statuses = new Set(
      TICKET_SOURCE_ERROR_CLASSES.map((errorClass) => TICKET_SOURCE_ERROR_STATUS[errorClass]),
    );

    expect([...statuses]).toStrictEqual(["error"]);
  });

  it("gives each class a distinct phrase", () => {
    // Four classes that render the same sentence are one class with three aliases, and the
    // person reading a red row would have no way to tell which of four things to do.
    const phrases = TICKET_SOURCE_ERROR_CLASSES.map(
      (errorClass) => TICKET_SOURCE_ERROR_REASONS[errorClass],
    );

    expect(new Set(phrases).size).toBe(phrases.length);
  });

  it.each(TICKET_SOURCE_ERROR_CLASSES)("gives %s a phrase that says something", (errorClass) => {
    const phrase = TICKET_SOURCE_ERROR_REASONS[errorClass];

    // `ticket_sources_status_reason_present` refuses a blank, and it refuses it for every
    // writer — so a phrase that were empty would be a background loop hitting a 23514.
    expect(phrase.trim()).not.toBe("");
    expect(phrase).toBe(phrase.toLowerCase());
  });

  it("says a credential is not worth retrying and a rate limit is", () => {
    // The two `false` entries are the two failures a retry can only waste time on. Asserted by
    // name rather than by iterating, because which two they are is the content of the table.
    expect(TICKET_SOURCE_ERROR_RETRYABLE.auth).toBe(false);
    expect(TICKET_SOURCE_ERROR_RETRYABLE.not_found).toBe(false);
    expect(TICKET_SOURCE_ERROR_RETRYABLE.rate_limit).toBe(true);
    expect(TICKET_SOURCE_ERROR_RETRYABLE.upstream).toBe(true);
  });
});

describe("statusReasonFor", () => {
  it("says when a rate limit lifts, which is the acceptance criterion's own example", () => {
    const reason = statusReasonFor(errorOf("rate_limit", new Date("2026-09-12T14:20:00.000Z")));

    // The criterion writes `rate limited until 14:20`; the zone is the four characters this
    // module adds, and `ticket-source.errors.ts` argues why a bare clock time composed on a
    // server and read in a browser somewhere else is the one part that cannot be honest.
    expect(reason).toBe("rate limited until 14:20 UTC");
  });

  it("prefers when over what, because when is the half somebody can act on", () => {
    const reason = statusReasonFor(
      errorOf("rate_limit", new Date("2026-09-12T14:20:00.000Z"), 429),
    );

    expect(reason).toBe("rate limited until 14:20 UTC");
    expect(reason).not.toContain("429");
  });

  it("falls back to the status when a tracker refused without saying when", () => {
    // A tracker that throttles and sends no `Retry-After` is common enough that the phrase has
    // to still mean something: `rate limited` alone is true, and appending nothing invented is
    // the point.
    expect(statusReasonFor(errorOf("rate_limit"))).toBe("rate limited");
    expect(statusReasonFor(errorOf("upstream", null, 503))).toBe("tracker unavailable (503)");
    expect(statusReasonFor(errorOf("auth", null, 401))).toBe("credentials rejected (401)");
    expect(statusReasonFor(errorOf("not_found", null, 404))).toBe(
      "project or repository not found (404)",
    );
  });

  it("says the plain phrase when there was no status at all", () => {
    // A GraphQL tracker's errors arrive inside a `200` and a transport failure has no status,
    // so `httpStatus: null` is an ordinary state rather than an incomplete one.
    expect(statusReasonFor(errorOf("upstream"))).toBe("tracker unavailable");
  });

  it("stays inside the column's bound across every branch, with the widest inputs there are", () => {
    // The composer has finitely many outputs — four phrases × three branches — and this
    // enumerates all of them rather than guarding at run time. `ticket-source.errors.ts`
    // argues why a guard would be worse: it would turn an edited phrase into a silent
    // ellipsis instead of a red test, which is this one.
    //
    // The widest status is three digits and the widest clock is `23:59 UTC`, so these are not
    // samples — they are the maxima.
    const widest = [null, new Date("2026-09-12T23:59:00.000Z")];

    for (const errorClass of TICKET_SOURCE_ERROR_CLASSES) {
      for (const retryAt of widest) {
        for (const httpStatus of [null, 599]) {
          const reason = statusReasonFor(errorOf(errorClass, retryAt, httpStatus));

          expect(reason.trim()).not.toBe("");
          expect(reason.length).toBeLessThanOrEqual(MAX_STATUS_REASON);
        }
      }
    }
  });

  it("keeps the phrases well inside the bound, so a reworded one has room", () => {
    // The bound is 200 and the longest phrase is a handful of words. Asserted with slack so
    // that the failure, when it comes, is about somebody pasting a paragraph rather than about
    // a phrase that grew by a word.
    for (const errorClass of TICKET_SOURCE_ERROR_CLASSES) {
      expect(TICKET_SOURCE_ERROR_REASONS[errorClass].length).toBeLessThan(MAX_STATUS_REASON / 2);
    }
  });

  it("never leaks a credential, whatever a provider put in its detail", () => {
    // The shortest path to a leaked token is a provider echoing a tracker's error body, and
    // tracker error bodies quote request headers. `detail` is a provider's own words and is
    // allowed to be specific — what must not happen is that it reaches the column a settings
    // page renders, which is a *different string*, composed from the class.
    for (const errorClass of TICKET_SOURCE_ERROR_CLASSES) {
      const leaky = new TicketSourceError(
        errorClass,
        `upstream said: authorization: Bearer ${FIXTURE_CREDENTIAL} (envelope ${FIXTURE_ENVELOPE})`,
      );

      const reason = statusReasonFor(leaky);

      expect(reason).not.toContain(FIXTURE_CREDENTIAL);
      expect(reason).not.toContain(FIXTURE_ENVELOPE);
      expect(reason).not.toContain("Bearer");
    }
  });
});

describe("formatClock", () => {
  it("reads as a clock time with its zone named", () => {
    expect(formatClock(new Date("2026-09-12T14:20:00.000Z"))).toBe("14:20 UTC");
  });

  it("pads both halves, so a status line does not reflow between minutes", () => {
    expect(formatClock(new Date("2026-09-12T04:05:00.000Z"))).toBe("04:05 UTC");
  });

  it("drops seconds, because a rate-limit window is not accurate to one", () => {
    expect(formatClock(new Date("2026-09-12T14:20:59.999Z"))).toBe("14:20 UTC");
  });
});

describe("classifyHttpStatus", () => {
  it.each([
    [301, "not_found"],
    [400, "not_found"],
    [401, "auth"],
    [403, "auth"],
    [404, "not_found"],
    [407, "auth"],
    [408, "upstream"],
    [422, "not_found"],
    [429, "rate_limit"],
    [500, "upstream"],
    [503, "upstream"],
  ])("reads %i as %s", (status, expected) => {
    expect(classifyHttpStatus(status)).toBe(expected);
  });

  it("refuses a success rather than inventing a plausible class", () => {
    // A caller that reached here with a `200` has a bug, and a taxonomy that answered
    // `upstream` would bury it behind a red row nobody could explain. A GraphQL tracker whose
    // errors arrive inside a `200` reads them out of the body and constructs the class itself.
    expect(() => classifyHttpStatus(200)).toThrow(RangeError);
    expect(() => classifyHttpStatus(299)).toThrow(RangeError);
  });
});

describe("TicketSourceError", () => {
  it("carries the class, the detail and nothing it was constructed from", () => {
    const error = new TicketSourceError("upstream", "503 from the listing call", null, 503);

    expect(error.errorClass).toBe("upstream");
    expect(error.detail).toBe("503 from the listing call");
    expect(error.message).toBe("503 from the listing call");
    expect(error.httpStatus).toBe(503);
    expect(error.retryAt).toBeNull();
    // Without the explicit assignment the name reads `Error`, and the name is what reaches a
    // log through `describeForLog`.
    expect(error.name).toBe("TicketSourceError");
  });

  it("recognises one from another copy of this module", () => {
    // Duck-typed rather than `instanceof`, because a community provider compiled separately
    // still has to be understood. The two fields checked are the two the loop reads.
    const foreign = { errorClass: "auth", detail: "key rejected" };

    expect(TicketSourceError.is(foreign)).toBe(true);
    expect(TicketSourceError.is(new TicketSourceError("auth", "x"))).toBe(true);
  });

  it.each([
    null,
    undefined,
    "auth",
    7,
    {},
    { errorClass: "teapot", detail: "x" },
    { errorClass: "auth" },
  ])("does not mistake %p for one", (candidate) => {
    expect(TicketSourceError.is(candidate)).toBe(false);
  });
});
