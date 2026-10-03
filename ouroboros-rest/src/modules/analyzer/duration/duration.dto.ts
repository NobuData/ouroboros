/**
 * What `GET /api/v1/analyzer/duration` accepts (BW.2, [#517](https://github.com/NobuData/ouroboros/issues/517)).
 */

import { LatestAnalysisQuery } from "../analysis.dto";

/** `?repo=` — the repository, `owner/name`, held to the same rule as the run routes'. */
export class DurationChartQuery extends LatestAnalysisQuery {}
