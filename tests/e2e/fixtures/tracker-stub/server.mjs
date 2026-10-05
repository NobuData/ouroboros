/**
 * The e2e suite's **sandbox tracker** — a GitHub that will really create issues, so the
 * planning leg can push to one.
 *
 * [#288](https://github.com/NobuData/ouroboros/issues/288), AM.6. It speaks the subset of
 * GitHub's REST API that `ouroboros-rest` sends at a tracker, on one port:
 *
 * ```
 * GET    /repos/{o}/{r}                                    the probe Test connection sends
 * GET    /repos/{o}/{r}/issues                             the walk both syncs make
 * POST   /repos/{o}/{r}/issues                             a push creating one
 * GET    /repos/{o}/{r}/issues/{n}                         a push reading one back
 * PATCH  /repos/{o}/{r}/issues/{n}                         the dependency body fallback
 * GET    /search/issues                                    the idempotency probe's second question
 * GET    /repos/{o}/{r}/milestones · POST                  ensureMilestone
 * GET    /repos/{o}/{r}/issues/{n}/dependencies/blocked_by · POST   native dependencies
 * GET    /repos/{o}/{r}/issues/{n}/sub_issues · POST                the epic parent link
 * GET    /repos/{o}/{r}/contents/{path}                    one file — a rules-file import's read
 * GET    /repos/{o}/{r}/git/trees/{sha}?recursive=1        the tree — the repo-map generator's read
 * GET    /repos/{o}/{r}/pulls/{n}                          the merge executor's re-check; a PR sync
 * GET    /repos/{o}/{r}/pulls/{n}/files                    a PR sync whose head moved
 * PUT    /repos/{o}/{r}/pulls/{n}/merge                    the merge itself
 * DELETE /repos/{o}/{r}/git/refs/heads/{branch}            the merged head branch
 * GET    /repos/{o}/{r}/issues/{n}/comments · POST         a keyed PR comment: look, then post
 * PATCH  /repos/{o}/{r}/issues/comments/{id}               … or edit the one already there
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Why a sandbox tracker exists at all.**
 *
 * The planning leg's subject is a push: an outline becomes drafts, the drafts become *issues*,
 * and what proves the push was real is reading those issues back out of the tracker — with
 * their dependencies and their epic parent — and then watching ordinary sync carry them home.
 * None of that can be asserted against a tracker nobody may write to, and none of it may be
 * asserted against github.com: a suite that runs nightly and creates six issues a night in
 * somebody's repository is not a suite, it is a mess.
 *
 * So the same shape `provider-stub` took for AE.7 ([#233](https://github.com/NobuData/ouroboros/issues/233)):
 * a real service at a real address, reached by the real adapter over the real network, with
 * the one thing the deployment needs to find it — `OURO_GITHUB_API_BASE_URL`, which
 * `github.octokit.ts` has had a parameter for since K.3 and no setting until this ticket.
 *
 * **It is a tracker, not a mock.** Nothing here is told what the suite expects. It holds
 * issues, milestones, `blocked_by` relations and sub-issue links, applies GitHub's own rules
 * about them — a number is assigned once, a relation is a set, a repository that does not
 * exist is a `404` — and answers in the documented shapes. Every assertion the leg makes is
 * therefore a question put to a tracker rather than a switch somebody flipped.
 *
 * **No dependencies, on purpose**, and `node:http` only, for `provider-stub`'s reason: a
 * fixture with a lockfile is a fixture that can fail to install on the morning of a release.
 *
 * ---------------------------------------------------------------------------
 * **The things it does that GitHub does not**, all under `/__sandbox/`, all refused on every
 * other path so nothing product-side can reach them — two levers, and two inspections (#470,
 * below):
 *
 *   * `POST /__sandbox/reset` — empty every repository back to {@link SEEDED_REPOS}. The leg
 *     runs it before it pushes, so a second run against a `--keep` stack starts where the
 *     first one did. It is the *fixture's* reset, not the product's: nothing in
 *     `ouroboros-rest` knows this route exists.
 *   * `POST /__sandbox/refuse-creates {"after": n}` — let `n` more issue creations through and
 *     refuse the one after that, once, with a `422`.
 *     This is the resume leg's lever, and it has to live here because the failure the leg is
 *     about is **the tracker refusing one draft in the middle of a batch**. Inducing it any
 *     other way — killing the service, cutting the network — would test a different failure:
 *     those stop the walk, and this one does not (`push.service.ts` § *Why a throttle stops
 *     the walk and a refusal does not*). A `422` on a payload is the refusal the idempotency
 *     contract is written for, so it is the one the leg induces.
 *
 *   * `GET /__sandbox/pulls/{o}/{r}/{n}` — the stored PR, with how it was merged
 *     (`merge_method`, `commit_title`, `commit_message`) and `head_branch_deleted`.
 *   * `GET /__sandbox/comments/{o}/{r}/{n}` — an issue's or a PR's conversation, oldest first.
 *
 * ---------------------------------------------------------------------------
 * **Issue numbers start at {@link FIRST_ISSUE_NUMBER}**, which is past every number any seed
 * writes — the intake mirror's `#483`–`#491` and the planning seed's `#540`–`#591`. A pushed
 * issue is therefore legible at a glance as this leg's, and a leg that read a seeded row
 * thinking it was its own — the failure mode hardest to see, because everything looks right —
 * cannot happen quietly.
 *
 * **Each repository numbers from its own range** ({@link NUMBER_RANGE} apart, since
 * [#422](https://github.com/NobuData/ouroboros/issues/422)). GitHub numbers per repository,
 * but the product's run queue is keyed by `(workspace, issue number)` — a workspace cannot
 * queue `#9000` twice, whichever repositories the two live in. The planning leg pushes into
 * the first repository and the knowledge leg files its issue in the second, on one stack and
 * one workspace, so two repositories that both began at 9000 would make whichever leg ran
 * second fail on the other's queue row. The first repository still begins at 9000, which is
 * the number the planning leg's assertions were written against.
 *
 * ---------------------------------------------------------------------------
 * **Repositories hold files too** (#422), read from `./repos/{owner}/{repo}/` beside this file
 * when the process starts. The knowledge leg's subject is a rules-file **import**:
 * `ouroboros-rest` asks the code host for `CLAUDE.md`, `AGENTS.md`, `.cursorrules` and
 * `.github/copilot-instructions.md` through GitHub's contents route, and the repo-map generator
 * asks for the tree. Both are answered here from the fixture files, in GitHub's documented
 * shapes: a file is base64 in a `type: "file"` document, a path that is not there is a `404`,
 * and the tree of a repository with no files is GitHub's `409` *Git Repository is empty* —
 * which is what a repository this tracker holds only issues for is.
 *
 * The files are the fixture's and not the leg's: `/__sandbox/reset` empties the issues and
 * leaves them, exactly as resetting a tracker would not delete a repository's source.
 *
 * ---------------------------------------------------------------------------
 * **It holds pull requests too** ([#470](https://github.com/NobuData/ouroboros/issues/470),
 * BO.5), so the inbox's action chains can finish against a host rather than stop at one. Approving
 * a merge card ends in `github.pr.ts`'s `mergePR` — read the PR, `PUT …/merge`, delete the head
 * branch, post the evidence comment — and waiving a claim ends in `commentPR`, which looks for its
 * keyed marker among the PR's conversation comments and edits or posts. Those are the routes
 * above, in GitHub's documented shapes, applying GitHub's rules: a merged PR is `closed` with a
 * `merged_at` and a `merge_commit_sha`, and merging it again is GitHub's `405`.
 *
 * The store holds one PR, {@link SEEDED_PULLS}' `#504` — the PR
 * `R__dev_seed_workspace_triage_inbox.sql` mirrors as `verifying`, at the head sha its revision 1 records — in the push target, because the
 * PR plane of a source is its push target (`github.pr.ts` § *The repository is the source's push
 * target*). Comments live beside it, keyed by `owner/repo#number`, and a comment may be filed on an
 * issue or a PR alike, as on GitHub, where a PR's conversation *is* an issue's.
 *
 * `/__sandbox/reset` puts `#504` back open and drops every comment. Two more read-only controls let
 * a leg ask what the host now holds — `GET /__sandbox/pulls/{o}/{r}/{n}` and
 * `GET /__sandbox/comments/{o}/{r}/{n}` — without presenting a credential, since they are the
 * suite's questions and not the product's.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The port. Fixed rather than read from the environment, for `provider-stub`'s reason: this is
 * composed at one address by one file, and a variable would be a second place to disagree.
 */
const PORT = 8080;

/**
 * The repositories this tracker holds, as `owner/repo`.
 *
 * The four `R__dev_seed.sql` enables for `acme-robotics` and the four the seeded GitHub ticket
 * source lists in its `config.repos` — the same four, which is the point: both syncs walk this
 * list, and a repository missing from it would be a `404` the suite would have to explain.
 * `helios-firmware` is first, so it is `pushTarget`'s answer and where every push lands.
 */
const SEEDED_REPOS = [
  "acme-robotics/helios-firmware",
  "acme-robotics/helios-console",
  "acme-robotics/helios-telemetry",
  "acme-robotics/atlas-scheduler",
];

/**
 * The first issue number this tracker hands out — see the module note on why it is not 1.
 */
const FIRST_ISSUE_NUMBER = 9000;

/**
 * How far apart two repositories' issue numbers begin — see the module note. Five hundred is
 * far past what any leg files in one run, so the ranges cannot meet.
 */
const NUMBER_RANGE = 500;

/** Where the fixture repositories' files are — `./repos/{owner}/{repo}/…`, beside this file. */
const FILES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "repos");

/** GitHub wraps a contents response's base64 at sixty characters; clients must tolerate it. */
const BASE64_LINE = 60;

/**
 * The host the `html_url`s claim.
 *
 * `https`, and that is a requirement rather than a flourish: `github.mapping.ts` refuses an
 * issue whose `html_url` is not `https://…` (`HTTPS_URL`), so a tracker answering its own
 * `http://` address would have every ticket rejected by the canonical mirror with a message
 * about a URL. `.invalid` is reserved by RFC 2606 and can never resolve, which is what keeps a
 * link somebody clicks in a screenshot from reaching a real site.
 */
const WEB_HOST = "https://sandbox-tracker.invalid";

/** The hourly budget this tracker reports — GitHub's number, so the guard reads a real one. */
const RATE_LIMIT = 5000;

/** The whole world: `owner/repo` to its contents. */
const repos = new Map();

/**
 * The pull requests the store starts with — see the module note.
 *
 * `#504` as `R__dev_seed_workspace_triage_inbox.sql` writes it: the title, the head branch
 * (`coalesce(run.branch_name, 'loop/465-telemetry-buffer-pool')`, and run #465 has no branch name),
 * base `main`, and revision 1's head sha `c4d81e7` — the **seven-character** sha exactly as the
 * seed stores it, so a sync after the merge finds the head unmoved (`syncPR` compares the two as
 * strings) and the re-check's `sameCommit` matches it. The files are run #1830's six `run_files`,
 * which is what the revision's snapshot is.
 */
const SEEDED_PULLS = [
  {
    slug: "acme-robotics/helios-firmware",
    number: 504,
    title: "telemetry: allocate frame buffers from a fixed pool",
    body: null,
    headRef: "loop/465-telemetry-buffer-pool",
    headSha: "c4d81e7",
    baseRef: "main",
    files: [
      { filename: "drivers/telemetry/tlm_buf.c", additions: 41, deletions: 52, status: "modified" },
      {
        filename: "drivers/telemetry/tlm_pool.c",
        additions: 88,
        deletions: 71,
        status: "modified",
      },
      {
        filename: "drivers/telemetry/tlm_pool.h",
        additions: 19,
        deletions: 23,
        status: "modified",
      },
      { filename: "subsys/telemetry/Kconfig", additions: 6, deletions: 15, status: "modified" },
      { filename: "subsys/telemetry/encoder.c", additions: 22, deletions: 19, status: "modified" },
      { filename: "tests/telemetry/test_tlm_pool.c", additions: 38, deletions: 0, status: "added" },
    ],
  },
];

/** The login a merge and a comment are attributed to — the token's owner, as GitHub would say. */
const SANDBOX_LOGIN = "ouroboros-sandbox";

/** The pull requests: `owner/repo#number` to the stored PR. */
const pulls = new Map();

/** Conversation comments: `owner/repo#number` (an issue's or a PR's) to its comments, oldest first. */
const comments = new Map();

/** The next comment id. GitHub numbers comments across the whole host, and so does this. */
let nextCommentId = 1;

/** Branches a merge deleted: `owner/repo` to the set of deleted head refs. */
const deletedRefs = new Map();

/**
 * The store's key for one PR or one conversation.
 *
 * @param {string} slug `owner/repo`.
 * @param {number | string} number The issue or PR number, as a number or as the path spelled it.
 * @returns {string} `owner/repo#number`.
 */
function keyOf(slug, number) {
  return `${slug}#${Number(number).toString()}`;
}

/**
 * Every file under a directory, as paths relative to it with `/` separators.
 *
 * @param {string} root The directory.
 * @param {string} [directory] The directory being walked; `root` on the first call.
 * @returns {string[]} The files' paths, sorted, so a tree listing is stable.
 */
function walk(root, directory = root) {
  let entries;

  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    // No fixture files for this repository: it holds issues only.
    return [];
  }

  return entries
    .flatMap((entry) => {
      const path = join(directory, entry.name);

      return entry.isDirectory() ? walk(root, path) : [relative(root, path).split(sep).join("/")];
    })
    .sort();
}

/**
 * The fixture files of every repository: `owner/repo` to a map of path to bytes.
 *
 * Read once, at start, and never written — see the module note on why a reset leaves them.
 */
const files = new Map(
  SEEDED_REPOS.map((slug) => {
    const root = join(FILES_ROOT, ...slug.split("/"));

    return [slug, new Map(walk(root).map((path) => [path, readFileSync(join(root, path))]))];
  }),
);

/** The next issue id. GitHub's database id, which the relation routes take instead of a number. */
let nextIssueId = 1;

/**
 * How many more issue creations to let through before refusing one — the resume leg's lever.
 *
 * `null` is disarmed. `POST /__sandbox/refuse-creates {"after": n}` sets it to `n`: the next
 * `n` creations succeed, the one after that is refused with a `422`, and the lever disarms
 * itself. One shot, because a standing refusal would fail the resume as well and the leg's
 * whole assertion is that the resume succeeds and files no duplicate.
 *
 * `after` is counted rather than a draft being named, because *which* create is the fourth is
 * a fact about the product — `push.service.ts` orders blockers first and creates the epic's
 * parent issue before any of them — and a fixture that knew draft keys would be a fixture the
 * leg could not use to observe that order.
 */
let creationsBeforeRefusal = null;

/**
 * Empty the world back to its repositories.
 *
 * @returns {void}
 */
function reset() {
  repos.clear();

  for (const [index, slug] of SEEDED_REPOS.entries()) {
    repos.set(slug, {
      issues: [],
      milestones: [],
      nextNumber: FIRST_ISSUE_NUMBER + index * NUMBER_RANGE,
      nextMilestone: 1,
    });
  }

  nextIssueId = 1;
  creationsBeforeRefusal = null;

  pulls.clear();
  comments.clear();
  deletedRefs.clear();
  nextCommentId = 1;

  const opened = new Date().toISOString();

  for (const seeded of SEEDED_PULLS) {
    pulls.set(keyOf(seeded.slug, seeded.number), {
      ...seeded,
      files: seeded.files.map((file) => ({ ...file })),
      state: "open",
      mergeable: true,
      merged: false,
      mergedAt: null,
      mergedBy: null,
      mergeCommitSha: null,
      mergeMethod: null,
      commitTitle: null,
      commitMessage: null,
      createdAt: opened,
      updatedAt: opened,
    });
  }
}

reset();

/**
 * Answer with a JSON document, carrying the rate-limit headers every answer carries.
 *
 * `github.rate-limit.ts` reads `x-ratelimit-remaining` and `x-ratelimit-reset` off **every**
 * response and refuses to call again once the remaining figure is under its floor. A tracker
 * that sent no headers would leave the guard with no evidence — which is safe, and is also a
 * code path the product does not take against a real GitHub. Sending them keeps the leg on the
 * same path a deployment is on.
 *
 * @param {import("node:http").ServerResponse} response The response.
 * @param {number} status The status code.
 * @param {unknown} body What to send.
 * @returns {void}
 */
function json(response, status, body) {
  const payload = JSON.stringify(body);

  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload).toString(),
    "x-ratelimit-limit": RATE_LIMIT.toString(),
    "x-ratelimit-remaining": (RATE_LIMIT - 1).toString(),
    "x-ratelimit-reset": Math.floor(Date.now() / 1000 + 3600).toString(),
  });
  response.end(payload);
}

/**
 * Read a request's JSON body.
 *
 * Draining is not optional even when the body is ignored: a handler that answered without
 * consuming one leaves the socket in a state Node's keep-alive will not reuse, which presents
 * as an intermittently slow call rather than as an error.
 *
 * @param {import("node:http").IncomingMessage} request The request.
 * @returns {Promise<Record<string, unknown>>} The parsed body, or an empty object.
 */
function readBody(request) {
  return new Promise((resolve) => {
    let text = "";

    request.on("data", (chunk) => {
      text += chunk;
    });
    request.on("end", () => {
      try {
        const parsed = JSON.parse(text === "" ? "{}" : text);

        resolve(parsed !== null && typeof parsed === "object" ? parsed : {});
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * Whether a request carries a credential.
 *
 * Any non-empty token is accepted — the sealed development credential the seed writes is not a
 * GitHub token and could not be. What is *not* accepted is no credential at all, because
 * "a source with no token is unauthorized" is a real state the product renders
 * (`sync paused (unauthorized)`), and a tracker that served anonymous callers would make it
 * untestable.
 *
 * @param {import("node:http").IncomingMessage} request The request.
 * @returns {boolean} True when some credential was presented.
 */
function authorized(request) {
  const header = request.headers.authorization;

  return typeof header === "string" && header.trim().split(" ").slice(1).join(" ").trim() !== "";
}

/**
 * One issue, in the shape GitHub's REST API documents it.
 *
 * Every field either mapping reads is here and nothing else: `github.mapping.ts` (the canonical
 * mirror), `issue.mapping.ts` (the intake mirror) and `github.write.ts` (the push) between them
 * name `id`, `number`, `title`, `body`, `state`, `labels`, `user`, `created_at`, `updated_at`,
 * `html_url` and `repository_url`.
 *
 * @param {string} slug `owner/repo`.
 * @param {object} issue The stored issue.
 * @returns {object} The payload.
 */
function issuePayload(slug, issue) {
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    labels: issue.labels.map((name) => ({ name })),
    user: { login: "ouroboros-sandbox" },
    milestone: issue.milestone === null ? null : { number: issue.milestone },
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    html_url: `${WEB_HOST}/${slug}/issues/${issue.number.toString()}`,
    repository_url: `${WEB_HOST}/repos/${slug}`,
  };
}

/**
 * The issues of a repository a listing asks for, in the order it asked for them.
 *
 * `state`, `since`, `sort` and `direction` are honoured because both syncs send them and each
 * means something: a cold walk asks for `state=open`, a resumed one for `state=all` with a
 * `since`, and the push's idempotency probe asks for the newest hundred by creation. A stub
 * that ignored them would answer every question with the same list, and the leg would pass
 * whether or not the product asked the right one.
 *
 * @param {object} repo The repository.
 * @param {URLSearchParams} params The query.
 * @returns {object[]} The matching issues, ordered and truncated to `per_page`.
 */
function listIssues(repo, params) {
  const state = params.get("state") ?? "open";
  const since = params.get("since");
  const sort = params.get("sort") ?? "created";
  const direction = params.get("direction") ?? "desc";
  const perPage = Number(params.get("per_page") ?? "30");

  const matching = repo.issues.filter((issue) => {
    if (state !== "all" && issue.state !== state) return false;

    return since === null || issue.updatedAt >= since;
  });

  const key = sort === "updated" ? "updatedAt" : "createdAt";

  matching.sort((left, right) => {
    // Ties on the stamp are broken by number, which is creation order — without it a walk of
    // issues written in the same millisecond has no defined order and the leg reads as flaky.
    const compared =
      left[key] === right[key] ? left.number - right.number : left[key] < right[key] ? -1 : 1;

    return direction === "asc" ? compared : -compared;
  });

  return matching.slice(0, Number.isFinite(perPage) && perPage > 0 ? perPage : 30);
}

/**
 * The phrase and repository a `GET /search/issues` query names.
 *
 * `github.write.ts`'s `searchQuery` composes `repo:{owner}/{repo} is:issue in:body "{phrase}"`,
 * and this reads exactly that back. Anything else is answered with no results rather than with
 * everything — a search that matched loosely would let the idempotency probe find an issue it
 * was not asking about, which is the one failure a push must never have.
 *
 * @param {string} query The `q` parameter.
 * @returns {{ slug: string, phrase: string } | null} What was asked, or null.
 */
function readSearch(query) {
  const repo = /repo:(\S+)/.exec(query);
  const phrase = /"([^"]*)"/.exec(query);

  if (repo === null || phrase === null) return null;

  return { slug: repo[1], phrase: phrase[1] };
}

/**
 * Find an issue by number.
 *
 * @param {object} repo The repository.
 * @param {string} number The number, as the path spelled it.
 * @returns {object | undefined} The issue.
 */
function issueOf(repo, number) {
  return repo.issues.find((issue) => issue.number === Number(number));
}

/**
 * One file, in the shape GitHub's contents route documents — the fields
 * `github.probe.ts` reads (`type`, `size`, `encoding`, `content`) and the three a client
 * expects beside them.
 *
 * @param {string} path The file's path in the repository.
 * @param {Buffer} bytes Its contents.
 * @returns {object} The payload.
 */
function contentsPayload(path, bytes) {
  const encoded = bytes.toString("base64");
  const lines = [];

  for (let at = 0; at < encoded.length; at += BASE64_LINE) {
    lines.push(encoded.slice(at, at + BASE64_LINE));
  }

  return {
    type: "file",
    name: path.split("/").at(-1),
    path,
    size: bytes.length,
    encoding: "base64",
    content: `${lines.join("\n")}\n`,
  };
}

/**
 * A repository's tree, listed recursively, in the shape GitHub's trees route documents: a
 * `tree` entry per directory and a `blob` per file.
 *
 * @param {Map<string, Buffer>} held The repository's files.
 * @returns {object} The payload.
 */
function treePayload(held) {
  const directories = new Set();

  for (const path of held.keys()) {
    const segments = path.split("/");

    for (let depth = 1; depth < segments.length; depth += 1) {
      directories.add(segments.slice(0, depth).join("/"));
    }
  }

  return {
    sha: "HEAD",
    truncated: false,
    tree: [
      ...[...directories].sort().map((path) => ({ path, type: "tree", mode: "040000" })),
      ...[...held.keys()].map((path) => ({ path, type: "blob", mode: "100644" })),
    ],
  };
}

/**
 * One PR, in the shape GitHub's pulls route documents it.
 *
 * The fields `github.pr.ts`'s `pullPayload` reads, and the merge fields GitHub answers beside
 * them (`merged`, `merge_commit_sha`), which a leg asserting *the PR was merged* reads back.
 * `head.repo.full_name` is the repository itself, which is what lets `deleteHead` delete the
 * branch: a head in a fork is not this token's to delete.
 *
 * @param {object} pull The stored PR.
 * @returns {object} The payload.
 */
function pullPayload(pull) {
  return {
    number: pull.number,
    html_url: `${WEB_HOST}/${pull.slug}/pull/${pull.number.toString()}`,
    title: pull.title,
    body: pull.body,
    state: pull.state,
    draft: false,
    merged: pull.merged,
    merged_at: pull.mergedAt,
    merged_by: pull.mergedBy === null ? null : { login: pull.mergedBy },
    merge_commit_sha: pull.mergeCommitSha,
    // GitHub reports mergeability only while a PR is open.
    mergeable: pull.state === "open" ? pull.mergeable : null,
    head: { ref: pull.headRef, sha: pull.headSha, repo: { full_name: pull.slug } },
    base: { ref: pull.baseRef, repo: { full_name: pull.slug } },
    additions: pull.files.reduce((sum, file) => sum + file.additions, 0),
    deletions: pull.files.reduce((sum, file) => sum + file.deletions, 0),
    changed_files: pull.files.length,
    created_at: pull.createdAt,
    updated_at: pull.updatedAt,
  };
}

/**
 * One changed file, in the shape GitHub's pull files route documents it — `filePayload`'s fields.
 *
 * `patch` is null, which GitHub also answers for a file too large to diff: the store holds the
 * seed's counts, not its source, and a made-up patch would be text nobody wrote.
 *
 * @param {object} file The stored file.
 * @returns {object} The payload.
 */
function pullFilePayload(file) {
  return {
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.additions + file.deletions,
    patch: null,
  };
}

/**
 * One conversation comment, in the shape GitHub's issue comments route documents it.
 *
 * `html_url` is `https`, because `github.pr.ts`'s `commentUrl` keeps only an https link and the
 * evidence comment's link is something the product shows.
 *
 * @param {string} slug `owner/repo`.
 * @param {number} number The issue or PR the comment is on.
 * @param {object} comment The stored comment.
 * @returns {object} The payload.
 */
function commentPayload(slug, number, comment) {
  const page = pulls.has(keyOf(slug, number)) ? "pull" : "issues";

  return {
    id: comment.id,
    body: comment.body,
    user: { login: SANDBOX_LOGIN },
    html_url: `${WEB_HOST}/${slug}/${page}/${number.toString()}#issuecomment-${comment.id.toString()}`,
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
  };
}

/**
 * A merge commit's sha — forty hex characters, derived from what was merged and when, so two
 * merges of two PRs never share one and a leg can tell the sha it was answered from a constant.
 *
 * @param {object} pull The stored PR being merged.
 * @param {string} at The instant of the merge.
 * @returns {string} The sha.
 */
function mergeShaOf(pull, at) {
  return createHash("sha1")
    .update(`${keyOf(pull.slug, pull.number)}@${pull.headSha}@${at}`)
    .digest("hex");
}

/**
 * Whether a number names a conversation in a repository — an issue it holds, or a PR in
 * {@link pulls}. GitHub files a PR's comments under the issues route, so both are accepted there.
 *
 * @param {string} slug `owner/repo`.
 * @param {object} repo The repository.
 * @param {string} number The number, as the path spelled it.
 * @returns {boolean} True when comments may be read or filed on it.
 */
function hasConversation(slug, repo, number) {
  return issueOf(repo, number) !== undefined || pulls.has(keyOf(slug, number));
}

/**
 * The repository and number a `/__sandbox/{pulls|comments}/{o}/{r}/{n}` inspection names.
 *
 * @param {string[]} parts The path's segments, `__sandbox` first.
 * @returns {{ slug: string, number: number } | null} What was asked, or null for a malformed path.
 */
function inspected(parts) {
  if (parts.length !== 5 || !/^[1-9][0-9]*$/.test(parts[4])) return null;

  return { slug: `${parts[2]}/${parts[3]}`, number: Number(parts[4]) };
}

/**
 * Handle one request.
 *
 * @param {import("node:http").IncomingMessage} request The request.
 * @param {import("node:http").ServerResponse} response The response.
 * @returns {Promise<void>} When it has been answered.
 */
async function handle(request, response) {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT.toString()}`);
  const path = url.pathname;
  const method = request.method ?? "GET";

  // The compose healthcheck's route.
  if (path === "/healthz") {
    json(response, 200, { ok: true, repos: [...repos.keys()] });
    return;
  }

  // ------------------------------------------------------------------ the sandbox's own controls
  if (path.startsWith("/__sandbox/")) {
    const control = await readBody(request);
    const segments = path.split("/").filter((part) => part !== "");

    // The two inspections — what the host now holds, for a leg's assertions. Read-only.
    if (method === "GET" && (segments[1] === "pulls" || segments[1] === "comments")) {
      const asked = inspected(segments);

      if (asked === null) {
        json(response, 404, { message: "no such sandbox control" });
        return;
      }

      if (segments[1] === "pulls") {
        const pull = pulls.get(keyOf(asked.slug, asked.number));

        if (pull === undefined) {
          json(response, 404, { message: "no such pull request in the sandbox" });
          return;
        }

        json(response, 200, {
          ...pullPayload(pull),
          merge_method: pull.mergeMethod,
          commit_title: pull.commitTitle,
          commit_message: pull.commitMessage,
          head_branch_deleted: deletedRefs.get(asked.slug)?.has(pull.headRef) ?? false,
        });
        return;
      }

      json(
        response,
        200,
        (comments.get(keyOf(asked.slug, asked.number)) ?? []).map((comment) =>
          commentPayload(asked.slug, asked.number, comment),
        ),
      );
      return;
    }

    if (path === "/__sandbox/reset" && method === "POST") {
      reset();
      json(response, 200, { ok: true });
      return;
    }

    if (path === "/__sandbox/refuse-creates" && method === "POST") {
      const after = control.after;

      creationsBeforeRefusal = typeof after === "number" && after >= 0 ? after : 0;
      json(response, 200, { ok: true, after: creationsBeforeRefusal });
      return;
    }

    json(response, 404, { message: "no such sandbox control" });
    return;
  }

  const body = method === "GET" ? {} : await readBody(request);

  if (!authorized(request)) {
    json(response, 401, { message: "Requires authentication" });
    return;
  }

  // ------------------------------------------------------------------ search
  if (path === "/search/issues" && method === "GET") {
    const asked = readSearch(url.searchParams.get("q") ?? "");
    const repo = asked === null ? undefined : repos.get(asked.slug);
    const items =
      repo === undefined || asked === null
        ? []
        : repo.issues.filter((issue) => (issue.body ?? "").includes(asked.phrase));

    json(response, 200, {
      total_count: items.length,
      incomplete_results: false,
      items: items.map((issue) => issuePayload(asked.slug, issue)),
    });
    return;
  }

  // ------------------------------------------------------------------ everything under a repo
  const parts = path.split("/").filter((part) => part !== "");

  if (parts[0] !== "repos" || parts.length < 3) {
    json(response, 404, { message: "Not Found" });
    return;
  }

  const slug = `${parts[1]}/${parts[2]}`;
  const repo = repos.get(slug);

  if (repo === undefined) {
    json(response, 404, { message: "Not Found" });
    return;
  }

  const rest = parts.slice(3);
  const now = new Date().toISOString();

  // GET /repos/{o}/{r} — the probe `validateConfig` sends.
  if (rest.length === 0 && method === "GET") {
    json(response, 200, { full_name: slug, has_issues: true });
    return;
  }

  // ------------------------------------------------------------------ files
  const held = files.get(slug) ?? new Map();

  // GET /repos/{o}/{r}/contents/{path} — one file, or GitHub's 404 for a path that is not one.
  if (rest[0] === "contents" && rest.length > 1 && method === "GET") {
    const wanted = rest.slice(1).map(decodeURIComponent).join("/");
    const bytes = held.get(wanted);

    if (bytes === undefined) {
      json(response, 404, { message: "Not Found" });
      return;
    }

    json(response, 200, contentsPayload(wanted, bytes));
    return;
  }

  // GET /repos/{o}/{r}/git/trees/{sha} — the whole tree. A repository with no files is, to a
  // host, one with no commits, and GitHub says so with a 409 rather than an empty list.
  if (rest[0] === "git" && rest[1] === "trees" && rest.length === 3 && method === "GET") {
    if (held.size === 0) {
      json(response, 409, { message: "Git Repository is empty." });
      return;
    }

    json(response, 200, treePayload(held));
    return;
  }

  // ------------------------------------------------------------------ milestones
  if (rest[0] === "milestones" && rest.length === 1) {
    if (method === "GET") {
      const state = url.searchParams.get("state") ?? "open";

      json(
        response,
        200,
        repo.milestones
          .filter((milestone) => state === "all" || milestone.state === state)
          .map((milestone) => ({
            number: milestone.number,
            title: milestone.title,
            state: milestone.state,
          })),
      );
      return;
    }

    if (method === "POST") {
      const title = typeof body.title === "string" ? body.title : "";
      const existing = repo.milestones.find((milestone) => milestone.title === title);

      if (existing !== undefined) {
        // GitHub answers 422 for a duplicate title, and `ensureMilestone` looks before it
        // creates — so this arm only runs if that look stopped working, which is worth saying.
        json(response, 422, { message: "Validation Failed", errors: [{ code: "already_exists" }] });
        return;
      }

      const milestone = { number: repo.nextMilestone, title, state: "open" };

      repo.nextMilestone += 1;
      repo.milestones.push(milestone);
      json(response, 201, milestone);
      return;
    }
  }

  // ------------------------------------------------------------------ pull requests
  if (rest[0] === "pulls" && rest.length >= 2) {
    const pull = pulls.get(keyOf(slug, rest[1]));

    if (pull === undefined) {
      json(response, 404, { message: "Not Found" });
      return;
    }

    // GET /repos/{o}/{r}/pulls/{n} — the PR as it stands.
    if (rest.length === 2 && method === "GET") {
      json(response, 200, pullPayload(pull));
      return;
    }

    // GET /repos/{o}/{r}/pulls/{n}/files — the changed files, one page: six fit in any page.
    if (rest.length === 3 && rest[2] === "files" && method === "GET") {
      json(response, 200, pull.files.map(pullFilePayload));
      return;
    }

    // PUT /repos/{o}/{r}/pulls/{n}/merge — GitHub's `405` for a PR that cannot be merged, which
    // is one already merged or closed, and otherwise the merge: closed, merged, with a commit.
    if (rest.length === 3 && rest[2] === "merge" && method === "PUT") {
      if (pull.merged || pull.state !== "open" || pull.mergeable === false) {
        json(response, 405, { message: "Pull Request is not mergeable" });
        return;
      }

      const mergeMethod =
        body.merge_method === "squash" || body.merge_method === "rebase"
          ? body.merge_method
          : "merge";

      pull.state = "closed";
      pull.merged = true;
      pull.mergedAt = now;
      pull.mergedBy = SANDBOX_LOGIN;
      pull.mergeCommitSha = mergeShaOf(pull, now);
      pull.mergeMethod = mergeMethod;
      pull.commitTitle = typeof body.commit_title === "string" ? body.commit_title : null;
      pull.commitMessage = typeof body.commit_message === "string" ? body.commit_message : null;
      pull.updatedAt = now;
      json(response, 200, {
        sha: pull.mergeCommitSha,
        merged: true,
        message: "Pull Request successfully merged",
      });
      return;
    }

    json(response, 404, { message: "Not Found" });
    return;
  }

  // DELETE /repos/{o}/{r}/git/refs/heads/{branch} — a branch may hold slashes, so the rest of the
  // path is the name. Deleting one twice is GitHub's `422 Reference does not exist`.
  if (rest[0] === "git" && rest[1] === "refs" && rest[2] === "heads" && rest.length > 3) {
    if (method !== "DELETE") {
      json(response, 404, { message: "Not Found" });
      return;
    }

    const branch = rest.slice(3).map(decodeURIComponent).join("/");
    const deleted = deletedRefs.get(slug) ?? new Set();

    if (deleted.has(branch)) {
      json(response, 422, { message: "Reference does not exist" });
      return;
    }

    deleted.add(branch);
    deletedRefs.set(slug, deleted);
    response.writeHead(204, {
      "x-ratelimit-limit": RATE_LIMIT.toString(),
      "x-ratelimit-remaining": (RATE_LIMIT - 1).toString(),
      "x-ratelimit-reset": Math.floor(Date.now() / 1000 + 3600).toString(),
    });
    response.end();
    return;
  }

  // ------------------------------------------------------------------ issues
  if (rest[0] !== "issues") {
    json(response, 404, { message: "Not Found" });
    return;
  }

  if (rest.length === 1 && method === "GET") {
    json(
      response,
      200,
      listIssues(repo, url.searchParams).map((issue) => issuePayload(slug, issue)),
    );
    return;
  }

  if (rest.length === 1 && method === "POST") {
    if (creationsBeforeRefusal !== null && creationsBeforeRefusal <= 0) {
      creationsBeforeRefusal = null;
      json(response, 422, {
        message: "Validation Failed",
        errors: [
          {
            resource: "Issue",
            field: "title",
            code: "custom",
            message: "the sandbox refused this one",
          },
        ],
      });
      return;
    }

    if (creationsBeforeRefusal !== null) creationsBeforeRefusal -= 1;

    const issue = {
      id: nextIssueId,
      number: repo.nextNumber,
      title: typeof body.title === "string" ? body.title : "",
      body: typeof body.body === "string" ? body.body : null,
      state: "open",
      labels: Array.isArray(body.labels)
        ? body.labels.filter((label) => typeof label === "string")
        : [],
      milestone: typeof body.milestone === "number" ? body.milestone : null,
      createdAt: now,
      updatedAt: now,
      blockedBy: [],
      subIssues: [],
    };

    nextIssueId += 1;
    repo.nextNumber += 1;
    repo.issues.push(issue);
    json(response, 201, issuePayload(slug, issue));
    return;
  }

  // PATCH /repos/{o}/{r}/issues/comments/{id} — edit a comment, wherever in the repository it is.
  if (rest[1] === "comments" && rest.length === 3) {
    const id = Number(rest[2]);
    const found = [...comments.entries()]
      .filter(([key]) => key.startsWith(`${slug}#`))
      .flatMap(([key, held]) => held.map((comment) => ({ key, comment })))
      .find(({ comment }) => comment.id === id);

    if (found === undefined || method !== "PATCH") {
      json(response, 404, { message: "Not Found" });
      return;
    }

    if (typeof body.body !== "string") {
      json(response, 422, {
        message: "Validation Failed",
        errors: [{ field: "body", code: "missing_field" }],
      });
      return;
    }

    found.comment.body = body.body;
    found.comment.updatedAt = now;
    json(response, 200, commentPayload(slug, Number(found.key.split("#")[1]), found.comment));
    return;
  }

  // GET · POST /repos/{o}/{r}/issues/{n}/comments — an issue's conversation, or a PR's.
  if (rest.length === 3 && rest[2] === "comments") {
    if (!hasConversation(slug, repo, rest[1])) {
      json(response, 404, { message: "Not Found" });
      return;
    }

    const key = keyOf(slug, rest[1]);
    const number = Number(rest[1]);

    if (method === "GET") {
      json(
        response,
        200,
        (comments.get(key) ?? []).map((comment) => commentPayload(slug, number, comment)),
      );
      return;
    }

    if (method === "POST") {
      if (typeof body.body !== "string" || body.body.trim() === "") {
        json(response, 422, {
          message: "Validation Failed",
          errors: [{ field: "body", code: "missing_field" }],
        });
        return;
      }

      const comment = { id: nextCommentId, body: body.body, createdAt: now, updatedAt: now };

      nextCommentId += 1;
      comments.set(key, [...(comments.get(key) ?? []), comment]);
      json(response, 201, commentPayload(slug, number, comment));
      return;
    }

    json(response, 404, { message: "Not Found" });
    return;
  }

  const issue = rest.length >= 2 ? issueOf(repo, rest[1]) : undefined;

  if (issue === undefined) {
    json(response, 404, { message: "Not Found" });
    return;
  }

  if (rest.length === 2 && method === "GET") {
    json(response, 200, issuePayload(slug, issue));
    return;
  }

  if (rest.length === 2 && method === "PATCH") {
    if (typeof body.body === "string") issue.body = body.body;
    if (typeof body.title === "string") issue.title = body.title;
    if (body.state === "open" || body.state === "closed") issue.state = body.state;
    issue.updatedAt = now;
    json(response, 200, issuePayload(slug, issue));
    return;
  }

  // The two relation routes. Both are sets — adding a member twice is not an error and does not
  // add a second, which is what makes a resumed push safe to run over work it already did.
  const relation =
    rest[2] === "sub_issues"
      ? { field: "subIssues", idField: "sub_issue_id" }
      : rest[2] === "dependencies" && rest[3] === "blocked_by"
        ? { field: "blockedBy", idField: "issue_id" }
        : null;

  if (relation === null) {
    json(response, 404, { message: "Not Found" });
    return;
  }

  if (method === "GET") {
    const members = issue[relation.field].flatMap((id) => {
      const member = repo.issues.find((candidate) => candidate.id === id);

      return member === undefined ? [] : [issuePayload(slug, member)];
    });

    json(response, 200, members);
    return;
  }

  if (method === "POST") {
    const id = body[relation.idField];
    const member = repo.issues.find((candidate) => candidate.id === id);

    if (member === undefined) {
      json(response, 422, {
        message: "Validation Failed",
        errors: [{ code: "invalid", field: relation.idField }],
      });
      return;
    }

    if (!issue[relation.field].includes(id)) {
      issue[relation.field].push(id);
      issue.updatedAt = now;
    }

    json(response, 201, issuePayload(slug, issue));
    return;
  }

  json(response, 404, { message: "Not Found" });
}

const server = createServer((request, response) => {
  void handle(request, response).catch((error) => {
    // A fixture that threw and hung would present as a ten-second Octokit deadline in the
    // middle of a push, which is the least readable failure this leg could produce.
    json(response, 500, { message: `sandbox tracker failed: ${String(error)}` });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  process.stdout.write(`tracker-stub listening on ${PORT.toString()}\n`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
