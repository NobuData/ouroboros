import type { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import { SHIPPED_KINDS } from "../../decisions/decision.kinds.fixture";
import { DomainError } from "../../errors/error.envelope";
import type {
  PreferencesChange,
  PreferencesRepository,
  StoredPreferences,
} from "./preferences.repository";
import {
  DEFAULT_PREFERENCES,
  NotificationPreferencesService,
  effectivePreferences,
  mailsKind,
} from "./preferences.service";

/** One person's row, in memory, with V100's defaults. */
class FakePreferences {
  row: StoredPreferences | undefined;

  lastSlot: Date | undefined;

  repository(): PreferencesRepository {
    return {
      get: () => Promise.resolve(this.row),
      upsert: (_org: string, _user: string, change: PreferencesChange) => {
        const base = this.row ?? { ...DEFAULT_PREFERENCES, updatedAt: new Date(0) };

        this.row = {
          digestEnabled: change.digestEnabled ?? base.digestEnabled,
          digestTime: change.digestTime ?? base.digestTime,
          instantSeverity: change.instantSeverity ?? base.instantSeverity,
          mutedKinds: change.mutedKinds ?? base.mutedKinds,
          updatedAt: new Date("2026-10-04T07:00:00Z"),
        };

        return Promise.resolve();
      },
      lastDigestSlot: () => Promise.resolve(this.lastSlot),
    } as unknown as PreferencesRepository;
  }
}

describe("NotificationPreferencesService (#463)", () => {
  let store: FakePreferences;
  let service: NotificationPreferencesService;

  const registry = {
    kinds: () =>
      Promise.resolve(Object.values(SHIPPED_KINDS).map((kind) => ({ kind, dormant: false }))),
  } as unknown as DecisionKindRegistry;

  beforeEach(() => {
    store = new FakePreferences();
    service = new NotificationPreferencesService(store.repository(), registry);
    jest.spyOn(service, "now").mockReturnValue(new Date("2026-10-04T07:00:00Z"));
  });

  it("answers the defaults when nothing is stored: digest off, instant err on, nothing muted", async () => {
    expect(await service.read("org-1", "user-a")).toEqual({
      digest: { enabled: false, time: "09:00", timeZone: "UTC", nextSendAt: null },
      instant: { severity: "err" },
      mutedKinds: [],
      isExplicit: false,
      updatedAt: null,
    });
  });

  it("round-trips a change", async () => {
    const written = await service.update("org-1", "user-a", {
      digestEnabled: true,
      digestTime: "08:15",
      instantSeverity: "off",
      mutedKinds: ["fact_review", "fact_review"],
    });

    expect(written).toEqual({
      digest: {
        enabled: true,
        time: "08:15",
        timeZone: "UTC",
        nextSendAt: "2026-10-04T08:15:00.000Z",
      },
      instant: { severity: "off" },
      mutedKinds: ["fact_review"],
      isExplicit: true,
      updatedAt: "2026-10-04T07:00:00.000Z",
    });
    expect(await service.read("org-1", "user-a")).toEqual(written);
  });

  it("changes the next send when the digest time changes", async () => {
    await service.update("org-1", "user-a", { digestEnabled: true });
    const before = (await service.read("org-1", "user-a")).digest.nextSendAt;
    const after = (await service.update("org-1", "user-a", { digestTime: "11:30" })).digest
      .nextSendAt;

    expect(before).toBe("2026-10-04T09:00:00.000Z");
    expect(after).toBe("2026-10-04T11:30:00.000Z");
  });

  it("keeps what a change leaves out", async () => {
    await service.update("org-1", "user-a", { mutedKinds: ["claim_waiver"] });
    const after = await service.update("org-1", "user-a", { digestEnabled: true });

    expect(after.mutedKinds).toEqual(["claim_waiver"]);
  });

  it("refuses a mute naming no declared kind", async () => {
    await expect(
      service.update("org-1", "user-a", { mutedKinds: ["fact_review", "custom:nope"] }),
    ).rejects.toMatchObject({
      code: "notification_kind_unknown",
      details: { mutedKinds: ["custom:nope"] },
    });
    await expect(
      service.update("org-1", "user-a", { mutedKinds: ["custom:nope"] }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.row).toBeUndefined();
  });

  it("fills defaults and reads mutes", () => {
    expect(effectivePreferences(undefined)).toBe(DEFAULT_PREFERENCES);
    expect(mailsKind({ ...DEFAULT_PREFERENCES, mutedKinds: ["fact_review"] }, "fact_review")).toBe(
      false,
    );
    expect(mailsKind(DEFAULT_PREFERENCES, "fact_review")).toBe(true);
  });
});
