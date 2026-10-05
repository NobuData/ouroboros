import type { RetentionSettings, RetentionTier, WorkspaceSettings } from "@/app/api/settings-workspace";

/**
 * The Workspace card's fixtures (BS.2, #492) — mockup 17's `acme-robotics` on a self-hosted
 * deployment, and the seeded 30/30/30/400 retention tiers, as the service answers them.
 */

/** When the fixture page was read. Every sweep below is measured from it. */
export const READ_AT = "2026-10-05T10:00:00.000Z";

/** The security model's residency section, as the payload links it. */
export const RESIDENCY_URL =
  "https://github.com/NobuData/ouroboros/blob/main/docs/SECURITY_MODEL.md#data-residency";

/** The payload's domain consequence sentence. */
export const CONSEQUENCE =
  "Changing the tenant domain changes how sign-in finds this workspace for everyone who uses it.";

/** The service's retention effect note. */
export const EFFECT =
  "Saving deletes nothing. Each class's next sweep applies the new tier; data past it is removed then.";

/**
 * The workspace card as an owner reads it.
 *
 * @param overrides Fields to replace.
 * @returns The payload.
 */
export function workspaceSettings(overrides: Partial<WorkspaceSettings> = {}): WorkspaceSettings {
  return {
    id: "org-acme",
    slug: "acme-robotics",
    deployment: "self_hosted",
    name: { value: "acme-robotics", editable: true, reason: null },
    domain: {
      value: "acme.ouroboros.dev",
      editable: true,
      reason: null,
      tags: [],
      consequence: CONSEQUENCE,
    },
    region: {
      label: "EU-West (Frankfurt)",
      selectable: false,
      source: "configured",
      reason: "deployment",
      docsUrl: RESIDENCY_URL,
    },
    trainingData: { enabled: false, changeable: false, reason: "deployment" },
    ...overrides,
  };
}

/**
 * The workspace card as a viewer reads it: nothing editable, by role.
 *
 * @returns The payload.
 */
export function viewerWorkspaceSettings(): WorkspaceSettings {
  const owner = workspaceSettings();

  return workspaceSettings({
    name: { ...owner.name, editable: false, reason: "role" },
    domain: { ...owner.domain, editable: false, reason: "role" },
  });
}

/**
 * One class's tier.
 *
 * @param dataClass The class.
 * @param days Its days.
 * @param nextSweepAt When it is next swept.
 * @returns The tier.
 */
export function tier(dataClass: string, days: number, nextSweepAt: string | null): RetentionTier {
  const audit = dataClass === "audit";

  return {
    dataClass,
    days,
    source: "policy",
    loopData: !audit,
    floor: audit ? 90 : 7,
    ceiling: audit ? 3650 : 365,
    updatedAt: null,
    updatedBy: null,
    nextSweepAt,
    lastSweep: null,
  };
}

/**
 * The retention tiers — 30/30/30/400, the loop classes next swept in four hours (the soonest)
 * and later, audit unswept in this deployment.
 *
 * @param overrides Fields to replace.
 * @returns The payload.
 */
export function retentionSettings(overrides: Partial<RetentionSettings> = {}): RetentionSettings {
  return {
    editable: true,
    reason: null,
    loopDays: 30,
    classes: [
      tier("transcripts", 30, "2026-10-05T14:00:00.000Z"),
      tier("build_logs", 30, "2026-10-05T16:00:00.000Z"),
      tier("artifacts", 30, "2026-10-06T02:00:00.000Z"),
      tier("audit", 400, null),
    ],
    effect: EFFECT,
    ...overrides,
  };
}
