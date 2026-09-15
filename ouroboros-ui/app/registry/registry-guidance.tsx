import { STEP_WORD, type StepStatus } from "@/app/models/states";
import { PROVIDERS_PATH } from "@/app/paths";
import { Button, Card, CardHead, Chip, EmptyState, Tag, cx, type ChipTone } from "@/app/ui";

import { ImportMenu } from "./import-menu";
import { NewAlias } from "./new-alias";
import { aliasCount } from "./table";
import {
  CONNECT_STEP_LINK,
  GUIDANCE_CARD_TITLE,
  GUIDANCE_READ_ONLY,
  type GuidanceState,
  type GuidanceStep,
  type ImportSource,
  type ImportState,
  guidanceNote,
  guidanceSteps,
  guidanceTitle,
} from "./view";

import "./registry.css";

/**
 * **Name your first model** — the guidance a registry with no aliases gets in the table's seat
 * (CI.6, [#596](https://github.com/NobuData/ouroboros/issues/596)).
 *
 * A fresh workspace would otherwise meet an empty table where the product's argument should
 * be, and *every model gets a name* means nothing to somebody with no names and no providers.
 * So the seat teaches the two ways in — create one, or connect a provider and import — and
 * knows which of those is possible yet: `app/registry/view.ts`'s `guidanceState` and
 * `guidanceSteps` decide, and this places.
 *
 * ### The routing page's path, in this page's hue
 *
 * The anatomy is `app/models/foundations-card.tsx`'s, and so are the step classes
 * (`.models-foundations*` in `app/models/models.css`, which this page already loads through the
 * section's frame): two numbered steps, both always drawn, the next one marked
 * `aria-current="step"` with the state's word beside its title. The one difference is the hue of
 * *next* — mockup 21 draws in the accent where mockup 06 draws in the model violet — which is the
 * single rule this page adds (`.registry-guidance__step--current`).
 *
 * ### Role-aware, and nothing hidden
 *
 * A member reads the same title, the same explanation and the same path, and gets one sentence
 * where the controls would be instead of the controls. The head's two actions above stay where
 * they are, inert with their reason, so the member still sees what exists.
 *
 * A Server Component: the two controls inside it declare their own client boundaries.
 */

/** What the guidance takes. */
export interface RegistryGuidanceProps {
  /** Which guidance, decided by `guidanceState`. */
  readonly state: GuidanceState;
  /** What the import control may do — the same answer the head's copy is given. */
  readonly importing: ImportState;
  /** Every alias name — none, here, but the dialog's contract takes the list. */
  readonly aliasNames: readonly string[];
  /** The workspace's connections, for the create dialog's *bind now* mode. */
  readonly sources: readonly ImportSource[];
  /** Whether this reader may create aliases. */
  readonly mayAdminister: boolean;
}

/** The id the card's `aria-labelledby` points at. */
const GUIDANCE_TITLE_ID = "registry-guidance-title";

/** The hue each step status wears — with the word beside it, never alone. */
const STEP_TONE: Record<StepStatus, ChipTone> = {
  done: "ok",
  current: "accent",
  pending: "neutral",
  unknown: "neutral",
};

/**
 * The modifier each status adds. The routing page's, except *next*, which is this page's accent.
 */
const STEP_CLASS: Record<StepStatus, string> = {
  done: "models-foundations__step--done",
  current: "registry-guidance__step--current",
  pending: "models-foundations__step--pending",
  unknown: "models-foundations__step--unknown",
};

/**
 * The card.
 *
 * @param props See {@link RegistryGuidanceProps}.
 * @returns The card, in the table's seat.
 */
export function RegistryGuidance({
  state,
  importing,
  aliasNames,
  sources,
  mayAdminister,
}: RegistryGuidanceProps) {
  return (
    <Card aria-labelledby={GUIDANCE_TITLE_ID} as="section" className="models__next" fill>
      <CardHead
        beside={<Tag>{aliasCount(0)}</Tag>}
        title={GUIDANCE_CARD_TITLE}
        titleId={GUIDANCE_TITLE_ID}
      />

      <EmptyState fill note={guidanceNote(state)} title={guidanceTitle(state)} variant="flush">
        <ol className="models-foundations">
          {guidanceSteps(state).map((step, index) => (
            <li
              aria-current={step.status === "current" ? "step" : undefined}
              className={cx("models-foundations__step", STEP_CLASS[step.status])}
              key={step.key}
            >
              {/* The number repeats the list's own order; the word beside the title is the state. */}
              <span aria-hidden className="models-foundations__mark">
                {index + 1}
              </span>
              <div className="models-foundations__body">
                <p className="models-foundations__title">
                  {step.title}
                  <Chip
                    dot={step.status === "unknown" ? "ring" : "filled"}
                    tone={STEP_TONE[step.status]}
                  >
                    {STEP_WORD[step.status]}
                  </Chip>
                </p>
                <p className="models-foundations__note">{step.note}</p>
                <StepAction
                  aliasNames={aliasNames}
                  importing={importing}
                  mayAdminister={mayAdminister}
                  sources={sources}
                  step={step}
                />
              </div>
            </li>
          ))}
        </ol>

        {state.readOnly && <p className="registry-guidance__readonly">{GUIDANCE_READ_ONLY}</p>}
      </EmptyState>
    </Card>
  );
}

/**
 * A step's controls: the link into Providers & keys, both ways to name a model, or only the one
 * that works without a connection.
 *
 * @param props.step The decided step — its `action` says which.
 * @param props.importing What the import control may do.
 * @param props.aliasNames Every alias name, for the dialog.
 * @param props.sources The workspace's connections, for the dialog.
 * @param props.mayAdminister Whether the reader may create — always true where an action is set.
 * @returns The controls, or nothing for a step that offers none.
 */
function StepAction({
  step,
  importing,
  aliasNames,
  sources,
  mayAdminister,
}: Readonly<{
  step: GuidanceStep;
  importing: ImportState;
  aliasNames: readonly string[];
  sources: readonly ImportSource[];
  mayAdminister: boolean;
}>) {
  if (step.action === null) return null;

  if (step.action === "connect") {
    return (
      <div className="models-foundations__action">
        <Button href={PROVIDERS_PATH} size="sm" tone="primary">
          {CONNECT_STEP_LINK}
        </Button>
      </div>
    );
  }

  return (
    <div className="models-foundations__action registry-guidance__actions">
      <NewAlias aliasNames={aliasNames} mayAdminister={mayAdminister} sources={sources} />
      {step.action === "name" && <ImportMenu aliasNames={aliasNames} state={importing} />}
    </div>
  );
}
