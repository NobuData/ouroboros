/**
 * Step-up re-authentication, for every surface that charges one (AD.2,
 * [#223](https://github.com/NobuData/ouroboros/issues/223); shared since BR.5,
 * [#489](https://github.com/NobuData/ouroboros/issues/489)).
 *
 * Revealing a credential and deleting a workspace both ask *"did this person just prove it is
 * them?"*, and they must ask the same registry: a password confirmed for one is the five-minute
 * proof the other honours, so the registry is a singleton provided here once and imported by both.
 */

import { Module } from "@nestjs/common";

import { StepUpRegistry, StepUpService } from "./step-up";

@Module({
  providers: [StepUpRegistry, StepUpService],
  exports: [StepUpRegistry, StepUpService],
})
export class StepUpModule {}
