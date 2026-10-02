/**
 * Every metric family the rollup jobs fill, in fill order (BI.2,
 * [#433](https://github.com/NobuData/ouroboros/issues/433)).
 *
 * One extractor per family, each in `extractors/` with its population written out in its header.
 * The `calibration` family (#435) is not here: its report reads `estimate_outcomes` directly and
 * its bias metric is signed, which the grain cannot store.
 */

import { buildDurationExtractor } from "./extractors/build_duration.extractor";
import { buildsExtractor } from "./extractors/builds.extractor";
import { costExtractor } from "./extractors/cost.extractor";
import { cycleExtractor } from "./extractors/cycle.extractor";
import { doraExtractor } from "./extractors/dora.extractor";
import { effortExtractor } from "./extractors/effort.extractor";
import { interventionsExtractor } from "./extractors/interventions.extractor";
import { testsExtractor } from "./extractors/tests.extractor";
import { throughputExtractor } from "./extractors/throughput.extractor";
import type { FamilyExtractor } from "./rollup.types";

/** The families, each filled independently — one failing does not stop the others. */
export const ROLLUP_EXTRACTORS: readonly FamilyExtractor[] = Object.freeze([
  throughputExtractor,
  interventionsExtractor,
  cycleExtractor,
  costExtractor,
  buildsExtractor,
  buildDurationExtractor,
  testsExtractor,
  effortExtractor,
  doraExtractor,
]);
