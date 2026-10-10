/**
 * The brief routes' request shapes (CM.2, [#621](https://github.com/NobuData/ouroboros/issues/621)).
 */

import { IsUUID } from "class-validator";

/** `…/research/investigations/{investigationId}/…`. */
export class InvestigationParams {
  @IsUUID()
  investigationId!: string;
}
