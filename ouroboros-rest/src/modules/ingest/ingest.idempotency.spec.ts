import { canonicalJson, requestDigest } from "./ingest.idempotency";

/**
 * What makes two requests one — and, more importantly, what makes two requests two.
 *
 * The digest is the thing standing between a stored response and the worst failure available
 * on this surface: a caller told *"your report landed"* about a report that did not. So both
 * directions are asserted, and the *same* direction is asserted against the differences a
 * real retry has — key order, whitespace, an optional field written as `undefined` — because
 * an executor that re-serialised its retry through a different library must not have its own
 * resend refused as a different request.
 */

describe("canonical form", () => {
  it("sorts keys at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("keeps array order, because an array's order is data", () => {
    // `events[]` is the batch's own sequence. Two orderings are two different batches, and
    // sorting them would make a reordered resend look like a replay of the first.
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it("drops undefined the way JSON.stringify drops it", () => {
    // A DTO whose optional field was absent and one whose optional field is explicitly
    // `undefined` are one request, so they must be one digest.
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("keeps null, which means something", () => {
    // On this surface `reservedBuildJob: null` *releases a reservation* and absent says
    // nothing. Collapsing the two would make a release and a silence one request.
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
    expect(requestDigest({ a: null })).not.toBe(requestDigest({}));
  });

  it("renders a Date as the instant it is, not as an empty object", () => {
    // A `Date`'s own enumeration is empty, so sorting its keys would render it `{}` — and two
    // requests differing only in a timestamp would share a digest.
    const at = new Date("2026-09-22T14:25:01.000Z");

    expect(canonicalJson({ at })).toBe('{"at":"2026-09-22T14:25:01.000Z"}');
    expect(requestDigest({ at })).not.toBe(
      requestDigest({ at: new Date("2026-09-22T14:25:02.000Z") }),
    );
  });
});

describe("the digest", () => {
  it("is the shape the receipt column accepts", () => {
    // `run_ingest_receipts_request_digest_shape`: sixty-four lower-case hex characters or it
    // is not a digest — which is what stops a service that forgot to hash from writing a
    // request body into that column.
    expect(requestDigest({ idempotencyKey: "sim-482-open" })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the same for two spellings of one request", () => {
    const first = { idempotencyKey: "k", files: [{ path: "a.c", status: "added" }] };
    const second = { files: [{ status: "added", path: "a.c" }], idempotencyKey: "k" };

    expect(requestDigest(first)).toBe(requestDigest(second));
  });

  it("differs for a key reused with a different body", () => {
    // The refusal this whole mechanism exists for. Without it the second request would be
    // answered with the first one's result, and the caller would have no way to find out.
    const first = { idempotencyKey: "k", files: [{ path: "a.c", status: "added" }] };
    const second = { idempotencyKey: "k", files: [{ path: "b.c", status: "added" }] };

    expect(requestDigest(first)).not.toBe(requestDigest(second));
  });

  it("notices a number that became a string", () => {
    // The pipe coerces, so this should not happen — and if a coercion is ever dropped, a
    // digest that ignored the difference would make `42` and `"42"` one report.
    expect(requestDigest({ additions: 42 })).not.toBe(requestDigest({ additions: "42" }));
  });
});
