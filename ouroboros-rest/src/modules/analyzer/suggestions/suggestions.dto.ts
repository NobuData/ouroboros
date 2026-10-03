/**
 * What `GET /api/v1/analyzer/suggestions` accepts (BW.3, [#518](https://github.com/NobuData/ouroboros/issues/518)).
 */

import { LatestAnalysisQuery } from "../analysis.dto";

/** `?repo=` — the repository, `owner/name`, held to the same rule as the run routes'. */
export class SuggestionsQuery extends LatestAnalysisQuery {}
