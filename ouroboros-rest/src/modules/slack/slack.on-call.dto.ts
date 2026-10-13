/**
 * The body of `PUT /api/v1/chat/on-call` (CA.3,
 * [#543](https://github.com/NobuData/ouroboros/issues/543)).
 *
 * One field, always present: the member to put on call, or `null` for nobody.
 */

import { IsString, ValidateIf } from "class-validator";

/** `PUT /api/v1/chat/on-call`. */
export class PutOnCallDto {
  /** The `memberId` of one of the resource's `candidates`, or `null` to leave nobody on call. */
  @ValidateIf((body: PutOnCallDto) => body.memberId !== null)
  @IsString({ message: "memberId must be a member id or null" })
  memberId!: string | null;
}
