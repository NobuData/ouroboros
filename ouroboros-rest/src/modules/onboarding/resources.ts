/**
 * Rows and derivations → the onboarding contract
 * ([#385](https://github.com/NobuData/ouroboros/issues/385)), exactly as `openapi.yaml`'s
 * `Onboarding` schema promises it.
 *
 * Three parts, and the split is decision **O1** made visible: `steps` is derived (from
 * `onboarding.derivation.ts`), `choices` is the only part the wizard stores, and `refs` points at
 * the card payloads so the page composes in one round trip.
 */

import type { OnboardingState } from "../db/schema";
import type {
  DerivedRail,
  DerivedStep,
  OnboardingStepNumber,
  OnboardingStepSource,
  OnboardingStepStatus,
} from "./onboarding.derivation";
import type {
  InstantiatedWorkflowRow,
  ScanRow,
  TemplateRow,
  TicketRow,
} from "./onboarding.repository";
import type { SurfacingDecision } from "./onboarding.surfacing";

/** Each step's stable key and the name the rail prints (mockup 13). */
export const STEP_LABELS: Readonly<Record<OnboardingStepNumber, { key: string; title: string }>> = {
  1: { key: "connect_github", title: "Connect GitHub" },
  2: { key: "pick_repo", title: "Pick a repo" },
  3: { key: "choose_workflow", title: "Choose a starting workflow" },
  4: { key: "first_loop", title: "Run your first loop" },
};

/** Where the import-skip sends the person — the settings surface (mockup 17). */
export const SETTINGS_PATH = "/settings";

/** One step of the rail. */
export interface OnboardingStepResource {
  readonly step: OnboardingStepNumber;
  readonly key: string;
  readonly title: string;
  readonly status: OnboardingStepStatus;
  readonly evidence: string | null;
  readonly reason: string | null;
  readonly regressed: boolean;
  readonly derivedFrom: OnboardingStepSource;
}

/** What the wizard stores — and all it stores. */
export interface OnboardingChoicesResource {
  readonly selectedTemplate: string | null;
  readonly pickedTicketId: string | null;
  readonly dismissed: boolean;
  readonly completedAt: string | null;
  readonly bypassedAt: string | null;
}

/** References to the cards' payloads. */
export interface OnboardingRefsResource {
  /** The newest detection scan, or null when the repository was never scanned. */
  readonly detectionScan: { scanSeq: number; scannedAt: string; durationMs: number } | null;
  /** The template tiles offered, in tile order. */
  readonly templates: readonly {
    slug: string;
    version: number;
    tier: string;
    scope: "global" | "organization";
  }[];
  /** The picked ticket, or null. */
  readonly pickedTicket: { id: string; externalKey: string; title: string; source: string } | null;
  /**
   * The workflow instantiated from the selected template — its slug and version in force — or
   * null while none is. What the readiness preflight is asked about (DK.2, #1319).
   */
  readonly workflow: { slug: string; version: number | null } | null;
}

/** `GET /api/v1/onboarding`. */
export interface OnboardingResource {
  readonly repo: string;
  readonly steps: readonly OnboardingStepResource[];
  readonly currentStep: OnboardingStepNumber | null;
  readonly choices: OnboardingChoicesResource;
  readonly refs: OnboardingRefsResource;
  readonly surfacing: SurfacingDecision;
}

/** `POST /api/v1/onboarding/skip`. */
export interface OnboardingSkipResource {
  readonly onboarding: OnboardingResource;
  /** Where to send the person. */
  readonly settingsPath: string;
  /** Always false in this release: the bundle import is BD.3 (#398). */
  readonly configurationImported: false;
}

/** Everything a resource is assembled from. */
export interface OnboardingParts {
  readonly repo: string;
  readonly rail: DerivedRail;
  readonly state: OnboardingState | undefined;
  readonly scan: ScanRow | undefined;
  readonly templates: readonly TemplateRow[];
  readonly ticket: TicketRow | undefined;
  /** The workflow instantiated from the selected template, or undefined. */
  readonly workflow: InstantiatedWorkflowRow | undefined;
  readonly surfacing: SurfacingDecision;
}

/**
 * One derived step, labelled.
 *
 * @param step - The derivation's step.
 * @returns The contract's step.
 */
export function stepResource(step: DerivedStep): OnboardingStepResource {
  return { ...STEP_LABELS[step.step], ...step };
}

/**
 * The wizard's choices; a repository never written reads as no choices.
 *
 * @param state - The row, or undefined.
 * @returns The choices.
 */
export function choicesResource(state: OnboardingState | undefined): OnboardingChoicesResource {
  return {
    selectedTemplate: state?.selected_template ?? null,
    pickedTicketId: state?.picked_ticket_id ?? null,
    dismissed: state?.dismissed ?? false,
    completedAt: state?.completed_at?.toISOString() ?? null,
    bypassedAt: state?.bypassed_at?.toISOString() ?? null,
  };
}

/**
 * The whole surface.
 *
 * @param parts - The rail, the stored choices and the card references.
 * @returns The resource.
 */
export function onboardingResource(parts: OnboardingParts): OnboardingResource {
  const { scan, ticket } = parts;

  return {
    repo: parts.repo,
    steps: parts.rail.steps.map(stepResource),
    currentStep: parts.rail.currentStep,
    choices: choicesResource(parts.state),
    refs: {
      detectionScan:
        scan === undefined
          ? null
          : {
              scanSeq: scan.scan_seq,
              scannedAt: scan.scanned_at.toISOString(),
              durationMs: scan.duration_ms,
            },
      templates: parts.templates.map((template) => ({
        slug: template.slug,
        version: template.version,
        tier: template.tier,
        scope: template.organization_id === null ? "global" : "organization",
      })),
      pickedTicket:
        ticket === undefined
          ? null
          : {
              id: ticket.id,
              externalKey: ticket.external_key,
              title: ticket.title,
              source: ticket.kind,
            },
      workflow:
        parts.workflow === undefined
          ? null
          : { slug: parts.workflow.slug, version: parts.workflow.current_version },
    },
    surfacing: parts.surfacing,
  };
}
