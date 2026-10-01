/**
 * The calibration report's query (BI.4, [#435](https://github.com/NobuData/ouroboros/issues/435)).
 *
 * `window` is optional and closed: an unknown window is a `422` naming the field, never a silent
 * fall-back to a range the caller did not ask for.
 */

import { IsIn, IsOptional } from "class-validator";

import { CALIBRATION_WINDOWS, type CalibrationWindow } from "./calibration.rules";

/** `GET /api/v1/insights/calibration?window=`. */
export class CalibrationQuery {
  /** `7d`, `30d` or `90d`; `30d` when absent. */
  @IsOptional()
  @IsIn(CALIBRATION_WINDOWS)
  window?: CalibrationWindow;
}
