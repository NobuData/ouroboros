import { budgetHeaders, httpError } from "../../github/github.fixture";
import { GithubRateLimiter } from "../../github/github.rate-limit";
import {
  describeTicketSourceWriteConformance,
  type TicketSourceWriteConformance,
} from "../conformance.write.fixture";
import { GithubTicketSourceProvider } from "./github.provider";
import { SOURCE_WORKSPACE, recordingFactory, syncContext } from "./github.provider.fixture";
import { writeRecording, type WriteRecordingOptions } from "./github.write-recordings.fixture";

/**
 * AL.3's write criteria for the first writing plugin: **the write kit is green for the GitHub
 * provider**, over a recorded GitHub ([#279](https://github.com/NobuData/ouroboros/issues/279)).
 *
 * Nothing stands in but the network — the real `GithubTicketSourceProvider`, K.3's real client and
 * its rate guard — and two GitHubs run:
 *
 *   * **github.com** — the dependency API present, so links are native.
 *   * **An older GitHub Enterprise Server** — the `blocked_by` routes answer `404`, so the
 *     capability probe falls back to body markers. This is the acceptance criterion's
 *     *"fallback path exercised against a no-native-dependencies fixture"*, and the kit's ledger
 *     counts those markers as the relations they stand for.
 *
 * `recover` forgets the rate guard's budget as well as lifting the refusal: the kit's `rate_limit`
 * recording stands the guard down for fifteen minutes, and *the tracker answering again* is the
 * window having passed.
 */

/**
 * A write harness over a fresh recording and a fresh provider.
 *
 * @param options - The recording's setup.
 * @returns The harness.
 */
function harness(options: WriteRecordingOptions = {}): TicketSourceWriteConformance {
  const github = writeRecording(options);
  const limiter = new GithubRateLimiter();
  const provider = new GithubTicketSourceProvider(
    recordingFactory(github.octokit).factory,
    limiter,
  );
  const healthy = budgetHeaders({ remaining: 4999 });

  return {
    provider,
    context: syncContext(),
    drafts: [
      {
        idempotencyKey: "b7f3a000-0000-4000-8000-000000000279:d0000000-0000-4000-8000-000000000001",
        title: "Journal writes before the OTA image is swapped",
        body: "So a power loss mid-swap can resume rather than brick.",
        labels: ["ota"],
        milestone: null,
      },
      {
        idempotencyKey: "b7f3a000-0000-4000-8000-000000000279:d0000000-0000-4000-8000-000000000003",
        title: "Power-loss test rig for the OTA swap",
        body: null,
        labels: [],
        milestone: null,
      },
    ],
    milestoneName: "Helios 2.1",
    epic: {
      epicId: "e0270000-0000-4000-8000-000000000279",
      title: "OTA power-loss safety",
      description: "Every OTA swap survives a power cut.",
    },
    ledger: () => github.ledger(),
    refuse: {
      auth: () => github.refuse(httpError(401, healthy)),
      // A token that may read and not write: a 403 with budget to spare.
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

describeTicketSourceWriteConformance(
  "GithubTicketSourceProvider (github.com, native dependencies)",
  () => harness(),
);

describeTicketSourceWriteConformance(
  "GithubTicketSourceProvider (older GHES, no dependency API — body-marker fallback)",
  () => harness({ nativeDependencies: false }),
);
