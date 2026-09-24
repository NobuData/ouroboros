import { budgetHeaders, httpError } from "../../github/github.fixture";
import { GithubRateLimiter } from "../../github/github.rate-limit";
import {
  describeTicketSourcePrConformance,
  type TicketSourcePrConformance,
} from "../conformance.pr.fixture";
import { GithubTicketSourceProvider } from "./github.provider";
import { SOURCE_WORKSPACE, recordingFactory, syncContext } from "./github.provider.fixture";
import { RECORDED_DEFAULT_BRANCH, prRecording } from "./github.pr-recordings.fixture";

/**
 * AX.1's criterion *"the conformance kit is green for both the GitHub provider and the fake
 * provider"* — the GitHub half, over a recorded GitHub
 * ([#357](https://github.com/NobuData/ouroboros/issues/357)).
 *
 * Nothing stands in but the network — the real `GithubTicketSourceProvider`, K.3's real client and
 * its rate guard. The recording is the sandbox: its `push` is a commit on a branch, its merge closes
 * an issue by keyword the way github.com does (default branch, same repository), and a reference to
 * another repository is a `404` — the silent failure the merge's verification must report.
 *
 * `recover` forgets the rate guard's budget as well as lifting the refusal, for the write kit's
 * reason.
 */

/**
 * A PR harness over a fresh recording and a fresh provider.
 *
 * @returns The harness.
 */
function harness(): TicketSourcePrConformance {
  const github = prRecording();
  const limiter = new GithubRateLimiter();
  const provider = new GithubTicketSourceProvider(
    recordingFactory(github.octokit).factory,
    limiter,
  );
  const healthy = budgetHeaders({ remaining: 4999 });

  return {
    provider,
    context: syncContext(),
    base: RECORDED_DEFAULT_BRANCH,
    push: (branch, files) => github.push(branch, files),
    open: (branch, title) => github.open(branch, title),
    openIssue: () => github.openIssue(),
    foreignReference: "acme-robotics/helios-bootloader#7",
    reviewer: "mara-okafor",
    ledger: () => github.ledger(),
    refuse: {
      auth: () => github.refuse(httpError(401, healthy)),
      permission: () => github.refuse(httpError(403, healthy)),
      validation: () => github.refuse(httpError(422, healthy)),
      rate_limit: () =>
        github.refuse(httpError(403, { ...budgetHeaders({ remaining: 0 }), "retry-after": "900" })),
      not_found: () => github.refuse(httpError(404, healthy)),
      upstream: () => github.refuse(httpError(503, healthy)),
    },
    recover: () => {
      github.recover();
      limiter.forget(SOURCE_WORKSPACE);
    },
  };
}

describeTicketSourcePrConformance("GithubTicketSourceProvider (github.com)", () => harness());
