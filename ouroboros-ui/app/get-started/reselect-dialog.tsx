"use client";

import Link from "next/link";
import { useId } from "react";

import type { OnboardingInstantiatedWorkflow, OnboardingTemplateTile } from "@/app/api/onboarding";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import {
  RESELECT_CANCEL,
  reselectConfirm,
  reselectKeeps,
  reselectLink,
  reselectTitle,
} from "./templates-view";

/** What the re-selection dialog is told. */
export interface ReselectDialogProps {
  /** The switch being confirmed, or null when the dialog is closed. */
  readonly confirming: {
    readonly next: OnboardingTemplateTile;
    readonly previous: OnboardingInstantiatedWorkflow;
  } | null;
  /** Keep the current choice — Escape, the backdrop, or the cancel. */
  readonly onClose: () => void;
  /** Go ahead and select the next tile. The dialog closes; the card shows the progress. */
  readonly onConfirm: (next: OnboardingTemplateTile) => void;
}

/**
 * The re-selection confirmation (BC.3, [#392](https://github.com/NobuData/ouroboros/issues/392)).
 *
 * A selection created a real, published workflow (O4), so switching to another template is not
 * a change of mind on a draft: the previous workflow stays, and a person who assumed it was
 * discarded would be surprised to find it later. The dialog states that plainly, links the
 * workflow it keeps, and asks once. Its description is that statement, so a screen reader hears
 * what remains before the question; focus opens in the panel, Tab is trapped there and Escape
 * keeps the current choice (`ShellOverlay`).
 *
 * @param props See {@link ReselectDialogProps}.
 * @returns The dialog while a switch is being confirmed, nothing otherwise.
 */
export function ReselectDialog({ confirming, onClose, onConfirm }: ReselectDialogProps) {
  const keeps = useId();

  if (confirming === null) return null;

  const { next, previous } = confirming;

  return (
    <ShellOverlay describedBy={keeps} label={reselectTitle(next)} onClose={onClose} open>
      <div className="tiles-dialog">
        <h2 className="shell-overlay__title">{reselectTitle(next)}</h2>
        <p className="tiles-dialog__keeps" id={keeps}>
          {reselectKeeps(previous)}
        </p>
        <Link className="tiles-dialog__link" href={previous.studioPath}>
          {reselectLink(previous)}
        </Link>
        <div className="tiles-dialog__actions">
          <Button onClick={() => onConfirm(next)} tone="primary" type="button">
            {reselectConfirm(next)}
          </Button>
          <Button onClick={onClose} tone="ghost" type="button">
            {RESELECT_CANCEL}
          </Button>
        </div>
      </div>
    </ShellOverlay>
  );
}
