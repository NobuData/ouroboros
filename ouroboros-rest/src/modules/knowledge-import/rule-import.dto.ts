/**
 * The shapes the rule-file import routes accept (BF.4,
 * [#413](https://github.com/NobuData/ouroboros/issues/413)).
 */

import { IsString, Length, Matches } from "class-validator";

import { OnboardingRepoQuery } from "../onboarding/onboarding.dto";

/** A preview's body: which repository's rules files. */
export class PreviewRuleImportBody extends OnboardingRepoQuery {}

/** An apply's body: the repository, and the preview's fingerprint it must still match. */
export class ApplyRuleImportBody extends OnboardingRepoQuery {
  /** `fingerprint` from the preview — lower-case hex sha256. */
  @IsString()
  @Length(64, 64)
  @Matches(/^[0-9a-f]{64}$/, {
    message: "fingerprint must be the preview's sha256, lower-case hex",
  })
  fingerprint!: string;
}
