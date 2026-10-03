/**
 * The bodies of the lifecycle's destructive routes (BR.5,
 * [#489](https://github.com/NobuData/ouroboros/issues/489)).
 *
 * `confirm` is validated as an optional boolean and *required to be `true`* by the service, so a
 * missing confirmation is the operation's own `400 confirmation_required` rather than a generic
 * validation failure — the dialog that sends it reads that code.
 */

import { IsBoolean, IsOptional, IsString, Length } from "class-validator";

/** The body of `POST /settings/lifecycle/pause` and `/disconnect`. */
export class ConfirmDto {
  /** The confirm dialog's explicit yes. */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

/** The body of `POST /settings/lifecycle/delete`. */
export class DeleteWorkspaceDto {
  /** The workspace's name, typed exactly. Compared byte for byte — no trimming, no case folding. */
  @IsString()
  @Length(1, 256)
  confirmName!: string;

  /** The password, when the session is not fresh enough to count as a step-up on its own. */
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  password?: string;
}
