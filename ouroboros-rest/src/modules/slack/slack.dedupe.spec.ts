import { SeenEvents } from "./slack.dedupe";

/** Event-id dedupe (#535): a redelivered event is processed exactly once, within a bound. */

const AT = new Date("2026-10-12T14:00:00Z");

/** A moment some milliseconds after {@link AT}. */
function after(ms: number): Date {
  return new Date(AT.getTime() + ms);
}

describe("SeenEvents", () => {
  it("says an id is new once, and a redelivery is not", () => {
    const seen = new SeenEvents();

    expect(seen.first("Ev1", AT)).toBe(true);
    expect(seen.first("Ev1", after(1000))).toBe(false);
    expect(seen.first("Ev1", after(60_000))).toBe(false);
  });

  it("tells ids apart", () => {
    const seen = new SeenEvents();

    expect(seen.first("Ev1", AT)).toBe(true);
    expect(seen.first("Ev2", AT)).toBe(true);
  });

  it("forgets an id after its lifetime, so the set cannot grow for ever", () => {
    const seen = new SeenEvents(100, 1000);

    seen.first("Ev1", AT);

    expect(seen.first("Ev1", after(1001))).toBe(true);
    expect(seen.size).toBe(1);
  });

  it("drops what has expired when something new arrives", () => {
    const seen = new SeenEvents(100, 1000);

    seen.first("Ev1", AT);
    seen.first("Ev2", after(100));
    seen.first("Ev3", after(1050));

    expect(seen.size).toBe(2);
    expect(seen.first("Ev2", after(1060))).toBe(false);
  });

  it("never holds more than its capacity: the oldest id goes first", () => {
    const seen = new SeenEvents(3, 60_000);

    for (const [index, id] of ["Ev1", "Ev2", "Ev3", "Ev4"].entries()) {
      seen.first(id, after(index));
    }

    expect(seen.size).toBe(3);
    // Ev1 was evicted, so it reads as new; Ev4 is still remembered.
    expect(seen.first("Ev4", after(10))).toBe(false);
    expect(seen.first("Ev1", after(11))).toBe(true);
  });
});
