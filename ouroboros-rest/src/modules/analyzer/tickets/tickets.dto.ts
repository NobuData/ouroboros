/**
 * What `GET /api/v1/analyzer/tickets` accepts (BW.4, [#519](https://github.com/NobuData/ouroboros/issues/519)).
 */

import { LatestAnalysisQuery } from "../analysis.dto";

/** `?repo=` — the repository, `owner/name`, held to the same rule as the run routes'. */
export class TicketsQuery extends LatestAnalysisQuery {}
