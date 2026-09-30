/**
 * The dry-run flip's body (BA.3, [#382](https://github.com/NobuData/ouroboros/issues/382)).
 *
 * `dryRun` is required and must be a real boolean: a `"false"`, a `0` or a `null` is a `422`
 * naming the field, never a truthy accident that lets the loop merge without a person.
 */

import { IsBoolean } from "class-validator";

/** `PATCH /api/v1/policies/dry-run`. */
export class PatchDryRunPolicyDto {
  /** The new value — `false` lets the system merge without a human in the loop. */
  @IsBoolean()
  dryRun!: boolean;
}
