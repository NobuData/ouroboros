/**
 * The release the marketing page announces, and what is new in it.
 *
 * RC1 — release candidate 1 — is the first release in which the loop runs for real. The full
 * list lives on the documentation site (`RELEASE_NOTES_URL`); this is the short version the
 * page shows, each feature linked to the page that documents it. Nothing here is a measured
 * figure: those come only from a reference-run bundle (see `reference-run.tsx`).
 */

/** The documentation site. */
export const DOCS_URL = "https://docs.ouroboros.build";

/** The release the page announces. */
export const RELEASE = "RC1";

/** The release's state, in words. */
export const RELEASE_STATE = "Release candidate 1";

/** The docs page listing everything in the release. */
export const RELEASE_NOTES_URL = `${DOCS_URL}/releases/rc1`;

/** One feature new in the release. */
export type ReleaseFeature = {
  /** What it is, in a few words. */
  title: string;
  /** One or two sentences on what it does for the reader. */
  copy: string;
  /** The docs page (and section) that documents it. */
  href: string;
};

/** What is new in RC1, in the order a first live loop meets it. */
export const RELEASE_FEATURES: readonly ReleaseFeature[] = [
  {
    title: "Live execution, admitted on purpose",
    copy: "An administrator switches real execution on. A queued issue starts only in dry-run, with the workspace unpaused, a slot free under its ceiling and a person confirming it.",
    href: `${DOCS_URL}/administration/live-execution#the-admission-check`,
  },
  {
    title: "Workflows execute",
    copy: "A run follows the workflow version it was queued with, stage by stage, live in the run console.",
    href: `${DOCS_URL}/user-guide/runs/console`,
  },
  {
    title: "Models through your registry",
    copy: "Every call resolves an alias through your routes and fallback chain, on your own keys, metered against the route's cap.",
    href: `${DOCS_URL}/user-guide/models#routing`,
  },
  {
    title: "A coding agent, fenced in",
    copy: "Coding stages run the Claude Agent SDK in a working tree of their own, with file tools only and guardrails checked at every tool call.",
    href: `${DOCS_URL}/administration/live-execution#stage-executors`,
  },
  {
    title: "Built on your runner",
    copy: "Build and test stages check out the run's branch on your own build farm; the exit code decides the gate.",
    href: `${DOCS_URL}/user-guide/runs/console#build-stages`,
  },
  {
    title: "A draft pull request",
    copy: "The loop pushes to a branch of its own and opens the pull request as a draft. A person reviews and merges it.",
    href: `${DOCS_URL}/user-guide/pull-requests#the-draft-pull-request-a-loop-opens`,
  },
  {
    title: "Every number says where it came from",
    copy: "Live, simulated or demo: screens count live data by default, label the rest in words, and show — rather than 0.",
    href: `${DOCS_URL}/user-guide/concepts#where-the-data-comes-from`,
  },
  {
    title: "A first loop that is real",
    copy: "The Get Started wizard checks everything the loop needs before it starts, names what blocks, and follows your first live run to its review.",
    href: `${DOCS_URL}/user-guide/getting-started/first-loop`,
  },
];

/** What RC1 does not do yet, said beside what it does. */
export const RELEASE_LIMITS =
  "RC1 opens draft pull requests only — it never merges — and live execution is off until an administrator switches it on.";
