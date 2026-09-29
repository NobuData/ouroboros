/**
 * The core rule packs, in the card's row order
 * ([#384](https://github.com/NobuData/ouroboros/issues/384)).
 *
 * The registration point: `detection.module.ts` provides this list as `RULE_PACKS`. A new pack is
 * a file beside these and an entry here — the orchestrator never names a pack.
 */

import type { RulePack } from "../detection.pack";
import { BUILD_PACK } from "./build.pack";
import { CONVENTIONS_PACK } from "./conventions.pack";
import { DEVCONTAINER_PACK } from "./devcontainer.pack";
import { LANGUAGE_PACK } from "./language.pack";
import { PROTECTED_PATHS_PACK } from "./protected-paths.pack";
import { TESTS_PACK } from "./tests.pack";

export const CORE_PACKS: readonly RulePack[] = [
  LANGUAGE_PACK,
  BUILD_PACK,
  DEVCONTAINER_PACK,
  TESTS_PACK,
  PROTECTED_PATHS_PACK,
  CONVENTIONS_PACK,
];
