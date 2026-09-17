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
 * **The two things it does that GitHub does not**, both under `/__sandbox/`, both refused on
 * every other path so nothing product-side can reach them:
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
 * ---------------------------------------------------------------------------
 * **Issue numbers start at {@link FIRST_ISSUE_NUMBER}**, which is past every number any seed
 * writes — the intake mirror's `#483`–`#491` and the planning seed's `#540`–`#591`. A pushed
 * issue is therefore legible at a glance as this leg's, and a leg that read a seeded row
 * thinking it was its own — the failure mode hardest to see, because everything looks right —
 * cannot happen quietly.
 */

import { createServer } from "node:http";

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

  for (const slug of SEEDED_REPOS) {
    repos.set(slug, {
      issues: [],
      milestones: [],
      nextNumber: FIRST_ISSUE_NUMBER,
      nextMilestone: 1,
    });
  }

  nextIssueId = 1;
  creationsBeforeRefusal = null;
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

  // ------------------------------------------------------------------ the sandbox's own two
  if (path.startsWith("/__sandbox/")) {
    const control = await readBody(request);

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
