import { describeSeats, readSeatCount, seatsIn, withSeats } from "./provider.entitlements";
import { CARD_SEPARATOR } from "./provider.errors";

/**
 * The entitlement vocabulary — AC.5's ([#220](https://github.com/NobuData/ouroboros/issues/220))
 * fourth acceptance criterion, at the layer where it is one function rather than a card.
 *
 * *"Seat count renders **only** from real entitlement data; the fixture without it renders the
 * cap line without a seat suffix."* The half a spec can hold is the gate: everything a provider
 * can answer that is not a count becomes `null`, `null` appends nothing, and what
 * {@link withSeats} writes is what {@link seatsIn} reads back — because AE.6
 * ([#232](https://github.com/NobuData/ouroboros/issues/232)) is on the other end of that
 * round trip and cannot import the adapter that wrote it.
 */

describe("reading a seat count off a provider's answer", () => {
  it("takes a whole count, zero included", () => {
    // Zero is a real state — an organization with Copilot billing and nobody assigned — and it
    // is the one place this floor differs from `NormalizedModel.contextLength`'s. See the
    // module header: the difference is whether a number was published or parsed.
    expect(readSeatCount(4)).toBe(4);
    expect(readSeatCount(0)).toBe(0);
    expect(readSeatCount(1)).toBe(1);
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["a string, as a JSON API sometimes answers", "4"],
    ["a float", 4.5],
    ["a negative", -1],
    ["a NaN from an unchecked parse", Number.NaN],
    ["an infinity", Number.POSITIVE_INFINITY],
    ["an object", { total: 4 }],
    ["an array", [4]],
    ["a boolean", true],
  ])("answers null for %s", (_description, value) => {
    // Decision P8: a seat count that is sometimes a guess is worse than no seat count, because
    // a reader cannot tell which is which.
    expect(readSeatCount(value)).toBeNull();
  });
});

describe("how a seat count reads", () => {
  it("pluralizes", () => {
    expect(describeSeats(4)).toBe("4 seats");
    expect(describeSeats(0)).toBe("0 seats");
  });

  it("says one seat rather than 1 seats", () => {
    // A single-licence organization is a real state, and `1 seats` on a card is the kind of
    // thing that makes a reader wonder what else was not looked at.
    expect(describeSeats(1)).toBe("1 seat");
  });
});

describe("appending an entitlement to a detail", () => {
  it("appends the count after the mockup's separator", () => {
    expect(withSeats("200", 4)).toBe("200 · 4 seats");
    expect(CARD_SEPARATOR).toBe(" · ");
  });

  it("appends nothing at all when there is no entitlement", () => {
    // Not `· seats unknown`, and not `· 0 seats`. A hedged suffix is a sentence a person has to
    // learn to distrust, and one untrustworthy suffix makes every other suffix unreadable.
    expect(withSeats("200", null)).toBe("200");
  });

  it("leaves a detail from an adapter that reports no entitlements exactly as it was", () => {
    // Which is what keeps every other card's foot reading `✓ 200 · 38ms` unchanged.
    expect(withSeats("503 upstream", null)).toBe("503 upstream");
  });
});

describe("reading an entitlement back out of a detail", () => {
  it.each([0, 1, 4, 512])("round-trips %i", (seats) => {
    // The contract AE.6's cap line depends on. A regular expression invented at the reading end
    // works until an adapter author rewords a message; this is the same six lines at both ends.
    expect(seatsIn(withSeats("200", seats))).toBe(seats);
  });

  it("answers null for a detail with no entitlement in it", () => {
    expect(seatsIn("200")).toBeNull();
    expect(seatsIn("key rejected (401)")).toBeNull();
    expect(seatsIn("")).toBeNull();
  });

  it("answers null for prose that merely mentions seats", () => {
    // The count has to be the whole of the trailing segment. A provider's own detail is not a
    // place to go looking for numbers.
    expect(seatsIn("200 · no seats available")).toBeNull();
    expect(seatsIn("seats")).toBeNull();
    expect(seatsIn("200 · 4 seats remaining")).toBeNull();
  });

  it("is safe to call on any adapter's detail rather than behind a capability check", () => {
    // Which is what lets a card read one line instead of branching on `capabilities()`.
    expect(seatsIn("200")).toBeNull();
    expect(seatsIn("unreachable (ECONNREFUSED)")).toBeNull();
    expect(seatsIn("200 · 4 seats")).toBe(4);
  });
});
