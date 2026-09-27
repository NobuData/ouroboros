/**
 * What the flake state routes accept — AT.3 ([#331](https://github.com/NobuData/ouroboros/issues/331)).
 */

import { Matches } from "class-validator";

/** A durable case key — V051's `test_cases_case_key_shape`: 64 lowercase hex digits. */
export const CASE_KEY_SHAPE = /^[0-9a-f]{64}$/;

/** The path of `/api/v1/flakes/cases/{caseKey}`. */
export class CaseKeyParams {
  /** The case's durable key (decision T2). Anything else is a `422`, not a probe's `404`. */
  @Matches(CASE_KEY_SHAPE, { message: "caseKey must be 64 lowercase hex digits" })
  caseKey!: string;
}
