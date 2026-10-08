import React, { type ReactNode } from "react";

import styles from "./styles.module.css";

/** Props of {@link UiPath}. */
export interface UiPathProps {
  /**
   * Where something is in the app, outermost first, separated by `>` (or `›`):
   * `"Settings > Members"`, `"Build farm > Runners > Drain"`.
   */
  path: string;
}

/**
 * Splits a UI path into its steps.
 *
 * @param path steps separated by `>` or `›`; whitespace around each step is ignored.
 * @returns the non-empty steps, in order.
 * @throws {Error} when the path holds no step — an empty `<UiPath>` is an authoring mistake
 *   the build should catch, not a blank the reader should find.
 */
export function uiPathSteps(path: string): string[] {
  const steps = path
    .split(/[>›]/)
    .map((step) => step.trim())
    .filter(Boolean);
  if (steps.length === 0) throw new Error(`<UiPath> needs at least one step, got "${path}"`);
  return steps;
}

/**
 * Names a place in the Ouroboros app the way its navigation reads — `Settings › Members` —
 * so every page points at screens the same way.
 *
 * @param props.path the steps, separated by `>`.
 * @returns the steps in bold, joined by `›`.
 */
export default function UiPath({ path }: UiPathProps): ReactNode {
  const steps = uiPathSteps(path);
  return (
    <span className={styles.uiPath}>
      {steps.map((step, index) => (
        <React.Fragment key={index}>
          {index > 0 && <span className={styles.separator}> › </span>}
          <span className={styles.step}>{step}</span>
        </React.Fragment>
      ))}
    </span>
  );
}
