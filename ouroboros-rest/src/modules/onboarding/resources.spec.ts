/** Rows and derivations → the onboarding contract ([#385](https://github.com/NobuData/ouroboros/issues/385)). */

import type { OnboardingState } from "../db/schema";
import { deriveRail } from "./onboarding.derivation";
import { choicesResource, onboardingResource, STEP_LABELS } from "./resources";

const REPO = "acme-robotics/helios-firmware";

const STATE = {
  id: "a7000000-0000-0000-0000-000000000001",
  organization_id: "org-1",
  repo_ref: REPO,
  selected_template: "quick-fixes",
  picked_ticket_id: "7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
  dismissed: false,
  completed_at: new Date("2026-09-29T10:00:00.000Z"),
  created_at: new Date("2026-09-29T09:00:00.000Z"),
  updated_at: new Date("2026-09-29T10:00:00.000Z"),
  bypassed_at: null,
  protected_paths_edited_at: null,
} satisfies OnboardingState;

const RAIL = deriveRail({
  repo: REPO,
  source: null,
  repository: null,
  scanned: false,
  selectedTemplate: null,
  workflow: null,
  pickedTicket: null,
  completed: false,
});

describe("the choices", () => {
  it("are empty for a repository nobody has written", () => {
    expect(choicesResource(undefined)).toEqual({
      selectedTemplate: null,
      pickedTicketId: null,
      dismissed: false,
      completedAt: null,
      bypassedAt: null,
    });
  });

  it("carry the row's values, dates as ISO strings", () => {
    expect(choicesResource(STATE)).toEqual({
      selectedTemplate: "quick-fixes",
      pickedTicketId: STATE.picked_ticket_id,
      dismissed: false,
      completedAt: "2026-09-29T10:00:00.000Z",
      bypassedAt: null,
    });
  });
});

describe("the onboarding resource", () => {
  it("labels every step with the mockup's names", () => {
    const resource = onboardingResource({
      repo: REPO,
      rail: RAIL,
      state: undefined,
      scan: undefined,
      templates: [],
      ticket: undefined,
      surfacing: { offer: true, reason: "fresh_organization" },
    });

    expect(resource.steps.map((step) => `${step.key}:${step.title}`)).toEqual(
      Object.values(STEP_LABELS).map((label) => `${label.key}:${label.title}`),
    );
    expect(resource.refs).toEqual({ detectionScan: null, templates: [], pickedTicket: null });
  });

  it("maps the card references", () => {
    const resource = onboardingResource({
      repo: REPO,
      rail: RAIL,
      state: STATE,
      scan: { scan_seq: 2, scanned_at: new Date("2026-09-29T09:30:00.000Z"), duration_ms: 38000 },
      templates: [
        { slug: "quick-fixes", version: 1, tier: "starter", organization_id: "org-1" },
        { slug: "deep-refactor", version: 1, tier: "advanced", organization_id: null },
      ],
      ticket: {
        id: STATE.picked_ticket_id,
        external_id: "488",
        external_key: "#488",
        title: "docs: fix typo in README",
        meta: {},
        kind: "github",
      },
      surfacing: { offer: false, reason: "wizard_finished" },
    });

    expect(resource.refs).toEqual({
      detectionScan: { scanSeq: 2, scannedAt: "2026-09-29T09:30:00.000Z", durationMs: 38000 },
      templates: [
        { slug: "quick-fixes", version: 1, tier: "starter", scope: "organization" },
        { slug: "deep-refactor", version: 1, tier: "advanced", scope: "global" },
      ],
      pickedTicket: {
        id: STATE.picked_ticket_id,
        externalKey: "#488",
        title: "docs: fix typo in README",
        source: "github",
      },
    });
    expect(resource.surfacing).toEqual({ offer: false, reason: "wizard_finished" });
  });
});
