/**
 * What `GET /api/v1/analyzer/measurements` accepts (BV.6, [#515](https://github.com/NobuData/ouroboros/issues/515)).
 */

import { LatestAnalysisQuery } from "../analysis.dto";

/** `?repo=` — the repository, `owner/name`, held to the same rule as the run routes'. */
export class MeasurementsQuery extends LatestAnalysisQuery {}
