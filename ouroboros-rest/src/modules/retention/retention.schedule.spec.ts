import { RetentionSchedule } from "./retention.schedule";

/** Each class's next sweep and last tombstone count, as the sweepers report them (#482). */
describe("the retention schedule", () => {
  const AT = new Date("2026-10-04T12:00:00.000Z");

  it("knows nothing of a class no sweeper has booked", () => {
    expect(new RetentionSchedule().status("audit")).toEqual({ nextAt: null, last: null });
  });

  it("records a booking, a finished sweep and a stop — per class", () => {
    const schedule = new RetentionSchedule();

    schedule.booked("build_logs", AT);
    schedule.swept("build_logs", AT, 12);
    expect(schedule.status("build_logs")).toEqual({ nextAt: AT, last: { at: AT, removed: 12 } });
    expect(schedule.status("artifacts")).toEqual({ nextAt: null, last: null });

    schedule.stopped("build_logs");
    expect(schedule.status("build_logs")).toEqual({ nextAt: null, last: { at: AT, removed: 12 } });
  });
});
