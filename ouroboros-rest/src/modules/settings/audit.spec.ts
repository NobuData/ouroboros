import { SETTINGS_AUTO_MERGE_CHANGED, SettingsAudit } from "./audit";

/**
 * The stub, held to the two things it already promises: the event's name is the one the
 * roadmap's F6 decision agreed, and emitting is survivable — a seam that threw would make
 * the audit path's absence a write failure, which is exactly backwards.
 */

describe("the settings audit seam", () => {
  it("names the event the trail will record", () => {
    expect(SETTINGS_AUTO_MERGE_CHANGED).toBe("settings.auto_merge_changed");
  });

  it("accepts a flip without effect — the emission is #90's to make real", () => {
    const audit = new SettingsAudit();

    expect(() =>
      audit.autoMergeChanged({
        organizationId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
        enabled: true,
        changedBy: "user-someone",
        changedAt: new Date("2026-08-13T09:00:00.000Z"),
      }),
    ).not.toThrow();
  });
});
