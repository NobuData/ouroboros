import { budgetHeaders, httpError } from "../../github/github.fixture";
import { GithubRateLimiter } from "../../github/github.rate-limit";
import {
  describeTicketSourceConformance,
  type TicketSourceConformance,
} from "../conformance.fixture";
import type { CanonicalTicket } from "../ticket-source.provider";
import { GithubTicketSourceProvider } from "./github.provider";
import {
  SOURCE_LOGIN,
  SOURCE_REPO,
  issuePayload,
  pullRequestPayload,
  recordingFactory,
  syncContext,
  type IssueOverrides,
} from "./github.provider.fixture";
import { recordedGithub } from "./github.recordings.fixture";

/**
 * Q.5's first acceptance criterion, for the first conforming plugin: **the kit is green for the
 * GitHub provider**, over recorded payloads
 * ([#142](https://github.com/NobuData/ouroboros/issues/142)).
 *
 * Nothing stands in but the network. The real `GithubTicketSourceProvider`, K.3's real
 * `GithubClient` and its rate guard run against `github.recordings.fixture.ts`, which serves
 * `issuePayload`'s recorded shapes filtered by the `state` and `since` the provider sends — so the
 * kit's cursor legs watch GitHub's inclusive `since` come back around the boundary issue and write
 * nothing, which is the case the loop's field-by-field comparison exists for.
 *
 * ```
 * #4 closed 09-05 · #1 open 09-11 09:00 · #3 PR 09-11 09:30 · #2 open 09-11 10:00
 *   cold import (state=open)         → #1 #2        cursor 09-11 10:00
 *   re-sync (since, inclusive)       → #2 again     writes nothing
 * ── change ──
 * #5 opened 09-12 08:00 · #7 opened closed 08:30 · #1 edited 09:00 · #2 closed 09:30
 *   incremental (state=all&since)    → #5 #7 #1 #2  cursor 09-12 09:30; #7 never stored
 * ```
 */

/** The link a recorded issue in the polled repository has. */
function issueUrl(number: number): string {
  return `https://github.com/${SOURCE_LOGIN}/${SOURCE_REPO}/issues/${number.toString()}`;
}

/** What every ticket from the polled repository carries in `meta`. */
const META = { github: { owner: SOURCE_LOGIN, repo: SOURCE_REPO } } as const;

/** `#1` as recorded: `issuePayload`'s defaults. */
const WATCHDOG: CanonicalTicket = {
  externalId: "1",
  externalKey: "#1",
  externalUrl: issueUrl(1),
  title: "Watchdog timer resets during I2C bus recovery",
  body: "The watchdog fires while the bus is recovered.",
  state: "open",
  labels: ["bug", "i2c"],
  author: "field-support",
  sourceCreatedAt: new Date("2026-09-10T09:00:00.000Z"),
  sourceUpdatedAt: new Date("2026-09-11T09:00:00.000Z"),
  meta: META,
};

/** `#2`'s payload overrides: no body, and opened by an account that is gone. */
const CALIBRATION_PAYLOAD: IssueOverrides = {
  number: 2,
  title: "Calibration drifts after firmware rollback",
  body: null,
  user: null,
  labels: [],
  created_at: "2026-09-10T10:00:00Z",
  updated_at: "2026-09-11T10:00:00Z",
};

/** `#2` as recorded. */
const CALIBRATION: CanonicalTicket = {
  externalId: "2",
  externalKey: "#2",
  externalUrl: issueUrl(2),
  title: "Calibration drifts after firmware rollback",
  body: null,
  state: "open",
  labels: [],
  author: null,
  sourceCreatedAt: new Date("2026-09-10T10:00:00.000Z"),
  sourceUpdatedAt: new Date("2026-09-11T10:00:00.000Z"),
  meta: META,
};

/** `#4`'s payload overrides: closed long before the first import. */
const FLASH_PAYLOAD: IssueOverrides = {
  number: 4,
  title: "Flash wear-levelling miscounts erase cycles",
  state: "closed",
  labels: [{ name: "storage" }],
  created_at: "2026-09-01T09:00:00Z",
  updated_at: "2026-09-05T09:00:00Z",
};

/** `#4` as recorded. */
const FLASH: CanonicalTicket = {
  externalId: "4",
  externalKey: "#4",
  externalUrl: issueUrl(4),
  title: "Flash wear-levelling miscounts erase cycles",
  body: "The watchdog fires while the bus is recovered.",
  state: "closed",
  labels: ["storage"],
  author: "field-support",
  sourceCreatedAt: new Date("2026-09-01T09:00:00.000Z"),
  sourceUpdatedAt: new Date("2026-09-05T09:00:00.000Z"),
  meta: META,
};

/** `#5`, opened after the cold import. */
const BOOTLOADER: CanonicalTicket = {
  externalId: "5",
  externalKey: "#5",
  externalUrl: issueUrl(5),
  title: "Bootloader rejects signed images after key rotation",
  body: "The watchdog fires while the bus is recovered.",
  state: "open",
  labels: ["security"],
  author: "release-eng",
  sourceCreatedAt: new Date("2026-09-12T08:00:00.000Z"),
  sourceUpdatedAt: new Date("2026-09-12T08:00:00.000Z"),
  meta: META,
};

/**
 * A harness over a freshly recorded GitHub and a fresh provider.
 *
 * A fresh rate guard too: the provider's budget is deliberately its own, and a case that reused one
 * would carry the rate-limit case's spent budget into the next.
 *
 * @returns The harness.
 */
function harness(): TicketSourceConformance {
  const github = recordedGithub([
    issuePayload(FLASH_PAYLOAD),
    issuePayload({ number: 1 }),
    pullRequestPayload({ number: 3, updated_at: "2026-09-11T09:30:00Z" }),
    issuePayload(CALIBRATION_PAYLOAD),
  ]);
  const provider = new GithubTicketSourceProvider(
    recordingFactory(github.octokit).factory,
    new GithubRateLimiter(),
  );

  return {
    provider,
    context: syncContext(),
    rejectedConfigs: [
      {
        name: "an account name with a slash in it",
        config: { login: "acme/robotics", repos: [SOURCE_REPO] },
      },
      { name: "no repository enabled", config: { login: SOURCE_LOGIN, repos: [] } },
      { name: "a repository name that traverses", config: { login: SOURCE_LOGIN, repos: [".."] } },
      { name: "not an object", config: `${SOURCE_LOGIN}/${SOURCE_REPO}` },
    ],
    mappings: [
      {
        name: "an open issue with labels and an author",
        raw: issuePayload({ number: 1 }),
        expected: WATCHDOG,
      },
      {
        name: "an issue with no body, opened by a deleted account",
        raw: issuePayload(CALIBRATION_PAYLOAD),
        expected: CALIBRATION,
      },
      { name: "a closed issue", raw: issuePayload(FLASH_PAYLOAD), expected: FLASH },
    ],
    unmappable: [
      {
        name: "a pull request, which the issues endpoint also answers",
        raw: pullRequestPayload({ number: 3 }),
      },
      { name: "a payload with no title or link", raw: { number: 2 } },
      {
        name: "an issue whose link is not https",
        raw: {
          ...issuePayload({ number: 8 }),
          html_url: "http://github.com/acme-robotics/x/issues/8",
        },
      },
    ],
    backlog: [WATCHDOG, CALIBRATION],
    changeUpstream: () => {
      github.record(
        issuePayload({
          number: 5,
          title: BOOTLOADER.title,
          labels: [{ name: "security" }],
          user: { login: "release-eng" },
          created_at: "2026-09-12T08:00:00Z",
          updated_at: "2026-09-12T08:00:00Z",
        }),
      );
      // Opened and closed between two polls, so the mirror never saw it open and must not store it.
      github.record(
        issuePayload({
          number: 7,
          title: "Duplicate of #5",
          state: "closed",
          created_at: "2026-09-12T08:15:00Z",
          updated_at: "2026-09-12T08:30:00Z",
        }),
      );
      github.record(
        issuePayload({
          number: 1,
          title: `${WATCHDOG.title}, revised`,
          updated_at: "2026-09-12T09:00:00Z",
        }),
      );
      github.record(
        issuePayload({
          ...CALIBRATION_PAYLOAD,
          state: "closed",
          updated_at: "2026-09-12T09:30:00Z",
        }),
      );
    },
    changedBacklog: [
      {
        ...WATCHDOG,
        title: `${WATCHDOG.title}, revised`,
        sourceUpdatedAt: new Date("2026-09-12T09:00:00.000Z"),
      },
      { ...CALIBRATION, state: "closed", sourceUpdatedAt: new Date("2026-09-12T09:30:00.000Z") },
      BOOTLOADER,
    ],
    refuse: {
      auth: () => github.refuse(httpError(401)),
      // GitHub's secondary spelling of a spent budget: a `403` with nothing remaining and a wait.
      rate_limit: () =>
        github.refuse(httpError(403, { ...budgetHeaders({ remaining: 0 }), "retry-after": "900" })),
      not_found: () => github.refuse(httpError(404)),
      upstream: () => github.refuse(httpError(503)),
    },
    // GitHub's provider polls; a delivery endpoint is a later ticket's.
    webhook: null,
  };
}

describeTicketSourceConformance("GithubTicketSourceProvider", harness);
