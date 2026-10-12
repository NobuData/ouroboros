/**
 * No copilot session, dry run or suggestion is reachable from another organisation — certified
 * over the development seeds (CD.6, [#564](https://github.com/NobuData/ouroboros/issues/564)).
 *
 * The seeded workspace holds one of everything this plane serves: the `security-patch` workflow
 * with its draft, the active conversation about it (six messages, one of them asking a
 * question), the finished dry run on a seeded ticket and the suggestions filed under it. A
 * second organisation — its own owner, its own workflow with a draft, its own ticket — asks
 * every route of the three controllers for those things, three ways:
 *
 * ```
 * theirs   under its own tenant header, with every id the victim's
 * mixed    under its own tenant header, its own workflow id, the victim's session / dry run /
 *          suggestion ids — the join a route forgets when it trusts the first id
 * posing   under the victim's tenant header, where it holds no membership
 * ```
 *
 * and each time must be told there is no such thing (`404` — never a `403`, which would confirm
 * the id exists), in a body carrying nothing of the victim's that the caller did not send
 * itself, with nothing of the victim's changed and **no request made to the engine**. The two
 * sending routes and the dry run's events are `text/event-stream` when they answer; here they
 * must refuse before a stream opens.
 *
 * The table is held against the router's own list: a route added to `copilot.controller.ts`,
 * `dry-runs.controller.ts` or `suggestions.controller.ts` without a line here fails the first
 * test, naming itself. And because a table of `404`s is only worth something if the same paths
 * answer their owner, the last tests read every `GET` as the victim's own viewer and hold the
 * leak detector against what that viewer is told.
 */

import request from "supertest";

import type { Method, Person, Workspace } from "../../../testing/harness.fixture";
import { routeTable } from "../../auth/route.table.fixture";
import { SCHEMA_NAME, type DryRun } from "../../db/schema";
import { DryRunsRepository } from "../../dry-runs/dry-runs.repository";
import { INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import { INTERNAL_DRY_RUN_REPLAY_ESTIMATES_PATH } from "../../internal/internal.paths";
import { fillRoute } from "../../planning/planning.routes.fixture";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { startCopilotStage, type CopilotStage } from "./certification.fixture";

const WORKFLOW = "/api/v1/workflows/:id";
const COPILOT = `${WORKFLOW}/copilot`;
const DRY_RUNS = `${WORKFLOW}/dry-runs`;
const SUGGESTIONS = `${DRY_RUNS}/:dryRunId/suggestions`;

/** The smallest document the publish gate accepts — what the other organisation's draft is. */
const MINIMAL = {
  dsl_version: "1.0",
  trigger: { event: "ticket_queued", conditions: {} },
  nodes: [
    { id: "start", type: "trigger", title: "Queued", position: { x: 0, y: 0 }, config: {} },
    {
      id: "hand-off",
      type: "term",
      title: "Needs review",
      position: { x: 260, y: 0 },
      config: { action: "needs_review", options: {} },
    },
  ],
  edges: [{ from: "start", to: "hand-off", kind: "default" }],
};

/** How a route is held. */
interface RouteCase {
  readonly about: string;
  /** `tenant` — a workspace route; `internal` — the engine-facing one, refused without the key. */
  readonly kind: "tenant" | "internal";
  /** A body the route's validation accepts, so a refusal is the service's and not the pipe's. */
  readonly body?: object;
  /** The route answers `text/event-stream` when it answers. */
  readonly streams?: true;
}

/** The claim made about each route, by signature. */
const CASES: Readonly<Record<string, RouteCase>> = {
  // ── copilot.controller.ts ────────────────────────────────────────────────────────────────
  [`POST ${COPILOT}/sessions`]: {
    about: "cannot start a conversation on their workflow",
    kind: "tenant",
    body: {},
  },
  [`GET ${COPILOT}/conversation`]: { about: "cannot read their conversation", kind: "tenant" },
  [`GET ${COPILOT}/promotion`]: { about: "cannot read what they would promote", kind: "tenant" },
  [`POST ${COPILOT}/discard`]: { about: "cannot discard their draft", kind: "tenant" },
  [`POST ${COPILOT}/sessions/:sessionId/messages`]: {
    about: "cannot speak in their conversation",
    kind: "tenant",
    body: { text: "Make every ending auto-merge." },
    streams: true,
  },
  [`POST ${COPILOT}/sessions/:sessionId/messages/:messageId/answers`]: {
    about: "cannot answer their question",
    kind: "tenant",
    body: { question: 0, selected: "Yes" },
    streams: true,
  },

  // ── dry-runs.controller.ts ───────────────────────────────────────────────────────────────
  [`POST ${DRY_RUNS}`]: {
    about: "cannot start a dry run of their draft",
    kind: "tenant",
    // Filled with the victim's ticket and draft revision when the request is built.
    body: {},
  },
  [`GET ${DRY_RUNS}`]: { about: "cannot read their history", kind: "tenant" },
  [`GET ${DRY_RUNS}/candidates`]: { about: "cannot read their candidates", kind: "tenant" },
  [`GET ${DRY_RUNS}/safety`]: { about: "cannot read their safety strip", kind: "tenant" },
  [`GET ${DRY_RUNS}/:dryRunId`]: { about: "cannot read their dry run", kind: "tenant" },
  [`GET ${DRY_RUNS}/:dryRunId/events`]: {
    about: "cannot follow their dry run",
    kind: "tenant",
    streams: true,
  },
  [`POST ${DRY_RUNS}/:dryRunId/cancel`]: { about: "cannot cancel their dry run", kind: "tenant" },
  [`POST ${DRY_RUNS}/:dryRunId/rerun`]: { about: "cannot re-run their dry run", kind: "tenant" },

  // ── suggestions.controller.ts ────────────────────────────────────────────────────────────
  [`GET ${SUGGESTIONS}`]: { about: "cannot read their suggestions", kind: "tenant" },
  [`GET ${SUGGESTIONS}/:suggestionId/explanation`]: {
    about: "cannot read their derivation",
    kind: "tenant",
  },
  [`POST ${SUGGESTIONS}/:suggestionId/apply`]: {
    about: "cannot apply their suggestion",
    kind: "tenant",
  },
  [`POST ${SUGGESTIONS}/:suggestionId/ignore`]: {
    about: "cannot ignore their suggestion",
    kind: "tenant",
  },

  // ── the engine-facing surface ────────────────────────────────────────────────────────────
  [`POST ${INTERNAL_DRY_RUN_REPLAY_ESTIMATES_PATH}`]: {
    about: "needs the key, and a session is not a key",
    kind: "internal",
    body: { stageKey: "build", kind: "build" },
  },
};

/** What a refusal may carry. */
interface Refusal {
  readonly status: number;
  readonly text: string;
  readonly type: string;
}

describe("copilot certification — every route, unreachable from another organisation (#564)", () => {
  let stage: CopilotStage;
  /** The other organisation: its owner, its workflow (with a draft) and its own ticket. */
  let other: {
    owner: Person;
    workspace: Workspace;
    workflowId: string;
    draftRev: number;
    ticketId: string;
  };
  /** The victim's ids, by the parameter a route spells them with. */
  let victim: Record<"id" | "sessionId" | "messageId" | "dryRunId" | "suggestionId", string>;
  /** The victim's ticket and the draft revision its dry run would be started at. */
  let victimStart: { ticketId: string; draftRev: number };
  /** Everything of the victim's a response to somebody else must not carry. */
  let secrets: string[];

  /** The rows of one workspace this plane owns, digested: equal before and after, or it moved. */
  async function footprint(organizationId: string): Promise<Record<string, string>> {
    const digest = (table: string, where: string): string =>
      `(select count(*)::text || ':' || coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), '')
          from ${SCHEMA_NAME}.${table} t where ${where})`;
    const owned = (table: string): string => digest(table, "t.organization_id = $1");
    const ofWorkflow = (table: string): string =>
      digest(
        table,
        `t.workflow_id in (select w.id from ${SCHEMA_NAME}.workflows w where w.organization_id = $1)`,
      );
    const row = await stage.one<Record<string, string>>(
      `select ${owned("workflows")} as workflows,
              ${ofWorkflow("workflow_versions")} as workflow_versions,
              ${owned("draft_operations")} as draft_operations,
              ${owned("copilot_sessions")} as copilot_sessions,
              ${owned("copilot_messages")} as copilot_messages,
              ${owned("dry_runs")} as dry_runs,
              ${owned("dry_run_stages")} as dry_run_stages,
              ${owned("dry_run_artifacts")} as dry_run_artifacts,
              ${owned("dry_run_suggestions")} as dry_run_suggestions`,
      [organizationId],
    );
    if (row === undefined) throw new Error("The footprint query answered no row.");

    return row;
  }

  /** A request as somebody, under a tenant header. */
  function as(person: Person, workspace: Workspace, method: Method, path: string): request.Test {
    return stage.api.as(person)(method, path).set(TENANT_HEADER, workspace.slug);
  }

  /** What of the victim's a response carries that the caller did not itself send. */
  function leaks(text: string, sent: string): string[] {
    return secrets.filter((secret) => text.includes(secret) && !sent.includes(secret));
  }

  /** The body a route is sent: its case's, with the dry-run start filled from the victim. */
  function bodyFor(signature: string, route: RouteCase, extra: object = {}): object | undefined {
    if (signature === `POST ${DRY_RUNS}`) return { ...victimStart, ...extra };

    return route.body;
  }

  /**
   * Send one request and read its refusal.
   *
   * @param test - The request, ready but for its body.
   * @param body - The body, when the route takes one.
   * @returns The status, the raw text and the content type.
   */
  async function refusalOf(test: request.Test, body: object | undefined): Promise<Refusal> {
    const response = await (body === undefined ? test : test.send(body));

    return {
      status: response.status,
      text: response.text,
      type: String(response.headers["content-type"] ?? ""),
    };
  }

  beforeAll(async () => {
    stage = await startCopilotStage();

    const seeded = await stage.one<{
      workflow_id: string;
      session_id: string;
      dry_run_id: string;
      ticket_id: string;
      draft_rev: number;
    }>(
      `select r.workflow_id, r.session_id, r.id as dry_run_id, r.ticket_id, w.draft_rev
         from ${SCHEMA_NAME}.dry_runs r
         join ${SCHEMA_NAME}.workflows w on w.id = r.workflow_id
         join ${SCHEMA_NAME}.copilot_sessions s on s.id = r.session_id and s.status = 'active'
        where r.organization_id = $1 and r.status = 'complete'
          and exists (select 1 from ${SCHEMA_NAME}.dry_run_suggestions g
                       where g.dry_run_id = r.id and g.status = 'open')
        order by r.started_at limit 1`,
      [stage.workspace.id],
    );
    if (seeded === undefined) {
      throw new Error(
        "The seeds hold no finished dry run with an open suggestion and a live session.",
      );
    }

    const asking = await stage.one<{ id: string }>(
      `select m.id from ${SCHEMA_NAME}.copilot_messages m
        where m.session_id = $1 and m.role = 'copilot'
        order by (m.choices is null), m.seq limit 1`,
      [seeded.session_id],
    );
    const suggestion = await stage.one<{ id: string }>(
      `select g.id from ${SCHEMA_NAME}.dry_run_suggestions g
        where g.dry_run_id = $1 and g.status = 'open' order by g.created_at limit 1`,
      [seeded.dry_run_id],
    );
    if (asking === undefined || suggestion === undefined) {
      throw new Error("The seeded conversation has no reply, or its dry run no open suggestion.");
    }

    victim = {
      id: seeded.workflow_id,
      sessionId: seeded.session_id,
      messageId: asking.id,
      dryRunId: seeded.dry_run_id,
      suggestionId: suggestion.id,
    };
    victimStart = { ticketId: seeded.ticket_id, draftRev: seeded.draft_rev };

    const { rows } = await stage.api.sql.query<{ secret: string }>(
      `select w.id::text as secret from ${SCHEMA_NAME}.workflows w where w.id = $1
       union all select w.slug from ${SCHEMA_NAME}.workflows w where w.id = $1
       union all select s.id::text from ${SCHEMA_NAME}.copilot_sessions s where s.workflow_id = $1
       union all select m.id::text from ${SCHEMA_NAME}.copilot_messages m where m.session_id = $2
       union all select left(m.body, 48) from ${SCHEMA_NAME}.copilot_messages m
                  where m.session_id = $2 and length(m.body) >= 24
       union all select r.id::text from ${SCHEMA_NAME}.dry_runs r where r.workflow_id = $1
       union all select r.pinned_sha from ${SCHEMA_NAME}.dry_runs r where r.workflow_id = $1
       union all select g.id::text from ${SCHEMA_NAME}.dry_run_stages g where g.dry_run_id = $3
       union all select g.id::text from ${SCHEMA_NAME}.dry_run_suggestions g where g.dry_run_id = $3
       union all select g.title from ${SCHEMA_NAME}.dry_run_suggestions g where g.dry_run_id = $3
       union all select t.id::text from ${SCHEMA_NAME}.tickets t where t.id = $4
       union all select t.external_key from ${SCHEMA_NAME}.tickets t where t.id = $4
       union all select t.title from ${SCHEMA_NAME}.tickets t where t.id = $4`,
      [victim.id, victim.sessionId, victim.dryRunId, victimStart.ticketId],
    );
    secrets = [...new Set(rows.map((row) => row.secret))];

    // The other organisation, with what it needs for its own requests to get as far as the
    // victim's id: a workflow with a draft, and a ticket of its own.
    const owner = await stage.api.signIn();
    const workspace = await stage.api.workspace(owner);
    const created = await as(owner, workspace, "post", "/api/v1/workflows")
      .send({ name: "Stranger flow" })
      .expect(201);
    const workflow = created.body as { id: string; draft: { etag: string } };

    await as(owner, workspace, "put", `/api/v1/workflows/${workflow.id}/draft`)
      .set("If-Match", workflow.draft.etag)
      .send({ definition: MINIMAL })
      .expect(200);

    const ticket = await stage.one<{ id: string }>(
      `with source as (
         insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
         values ($1, 'custom', 'Stranger tracker', '{}'::jsonb) returning id
       )
       insert into ${SCHEMA_NAME}.tickets
         (organization_id, source_id, external_id, external_key, external_url, title, body, state,
          labels, author, source_created_at, source_updated_at, synced_at, sizing_status, meta)
       select $1, source.id, 'S-1', 'S-1', 'https://tracker.invalid/S-1', 'A stranger''s own ticket',
              '', 'open', '[]'::jsonb, 'stranger', now(), now(), now(), t.sizing_status, '{}'::jsonb
         from source, ${SCHEMA_NAME}.tickets t where t.id = $2
       returning id`,
      [workspace.id, victimStart.ticketId],
    );
    if (ticket === undefined) throw new Error("The other organisation's ticket was not written.");

    const revision = await stage.one<{ draft_rev: number }>(
      `select draft_rev from ${SCHEMA_NAME}.workflows where id = $1`,
      [workflow.id],
    );
    if (revision === undefined) throw new Error("The other organisation's workflow is gone.");

    other = {
      owner,
      workspace,
      workflowId: workflow.id,
      draftRev: revision.draft_rev,
      ticketId: ticket.id,
    };
  });

  afterAll(async () => {
    expect(stage.engine.strays).toEqual([]);
    await stage.close();
  });

  beforeEach(() => {
    stage.engine.reset();
  });

  /** Every route of the three controllers, and the engine-facing one beside them. */
  function planeRoutes(): string[] {
    return routeTable(stage.api.nest)
      .filter(
        (route) =>
          route.path.startsWith(`${COPILOT}/`) ||
          route.path === DRY_RUNS ||
          route.path.startsWith(`${DRY_RUNS}/`) ||
          route.path === INTERNAL_DRY_RUN_REPLAY_ESTIMATES_PATH,
      )
      .map((route) => route.signature)
      .sort();
  }

  it("HAS A CLAIM FOR EVERY COPILOT, DRY-RUN AND SUGGESTION ROUTE THE APPLICATION REGISTERS", () => {
    expect(planeRoutes()).toEqual(Object.keys(CASES).sort());
  });

  describe("each route holds the line", () => {
    it.each(
      Object.entries(CASES).map(([signature, value]) => [signature, value.about, value] as const),
    )("%s — %s", async (signature, _about, route) => {
      const [verb, path] = signature.split(" ") as [string, string];
      const method = verb.toLowerCase() as Method;
      const before = await footprint(stage.workspace.id);
      const mine = await footprint(other.workspace.id);

      if (route.kind === "internal") {
        const target = fillRoute(path, { id: victim.dryRunId });
        const answers = [
          // No key.
          await refusalOf(request(stage.api.baseUrl)[method](target), route.body),
          // A session is not a key — the victim's own owner, in the victim's own workspace.
          await refusalOf(as(stage.people.owner, stage.workspace, method, target), route.body),
          // Nor is the other organisation's.
          await refusalOf(as(other.owner, other.workspace, method, target), route.body),
          // A key that is not the key.
          await refusalOf(
            request(stage.api.baseUrl)[method](target).set(INTERNAL_KEY_HEADER, "not-the-key"),
            route.body,
          ),
        ];

        for (const answer of answers) {
          expect(answer.status).toBe(401);
          expect(leaks(answer.text, target)).toEqual([]);
        }
      } else {
        const theirs = fillRoute(path, victim);
        const mixed = fillRoute(path, { ...victim, id: other.workflowId });
        const attempts: { name: string; test: request.Test; sent: string; body?: object }[] = [
          {
            name: "theirs",
            test: as(other.owner, other.workspace, method, theirs),
            sent: theirs,
            body: bodyFor(signature, route),
          },
          {
            name: "posing",
            test: as(other.owner, stage.workspace, method, theirs),
            sent: theirs,
            body: bodyFor(signature, route),
          },
        ];

        // A route that names more than the workflow is asked once more, with the caller's own
        // workflow in front of the victim's session, dry run or suggestion.
        if (mixed !== fillRoute(path, { ...victim, id: victim.id }) && /:(?!id\b)/.test(path)) {
          attempts.push({
            name: "mixed",
            test: as(other.owner, other.workspace, method, mixed),
            sent: mixed,
            body: bodyFor(signature, route),
          });
        }

        for (const attempt of attempts) {
          const sent = `${attempt.sent} ${JSON.stringify(attempt.body ?? {})}`;
          const answer = await refusalOf(attempt.test, attempt.body);

          expect({ attempt: attempt.name, status: answer.status }).toEqual({
            attempt: attempt.name,
            status: 404,
          });
          // Refused before a stream opened: an envelope, never an event.
          expect(answer.type).toContain("application/json");
          expect(answer.text).not.toContain("event: ");
          expect({ attempt: attempt.name, leaks: leaks(answer.text, sent) }).toEqual({
            attempt: attempt.name,
            leaks: [],
          });
        }
      }

      expect(await footprint(stage.workspace.id)).toEqual(before);
      expect(await footprint(other.workspace.id)).toEqual(mine);
      expect(stage.engine.turns).toEqual([]);
      expect(stage.engine.runs).toEqual([]);
    });
  });

  describe("a dry run started in the other organisation", () => {
    /** Start one on the other organisation's own workflow, with something of the victim's in the body. */
    async function start(body: object): Promise<request.Response> {
      return as(
        other.owner,
        other.workspace,
        "post",
        `/api/v1/workflows/${other.workflowId}/dry-runs`,
      ).send({ draftRev: other.draftRev, ...body });
    }

    it("cannot be pointed at the victim's ticket", async () => {
      const before = await footprint(stage.workspace.id);
      const mine = await footprint(other.workspace.id);

      const answer = await start({ ticketId: victimStart.ticketId });

      expect(answer.status).toBe(404);
      expect((answer.body as { code?: string }).code).toBe("dry_run_ticket_not_found");
      expect(leaks(answer.text, victimStart.ticketId)).toEqual([]);
      expect(await footprint(stage.workspace.id)).toEqual(before);
      expect(await footprint(other.workspace.id)).toEqual(mine);
      expect(stage.engine.runs).toEqual([]);
    });

    it("cannot be attributed to the victim's conversation", async () => {
      const before = await footprint(stage.workspace.id);
      const mine = await footprint(other.workspace.id);

      const answer = await start({ ticketId: other.ticketId, sessionId: victim.sessionId });

      expect(answer.status).toBe(422);
      expect((answer.body as { code?: string }).code).toBe("dry_run_session_mismatch");
      expect(leaks(answer.text, victim.sessionId)).toEqual([]);
      expect(await footprint(stage.workspace.id)).toEqual(before);
      // Refused before a row was recorded: the other organisation has no dry run either.
      expect(await footprint(other.workspace.id)).toEqual(mine);
      expect(stage.engine.runs).toEqual([]);
    });
  });

  describe("and the same paths answer their owner", () => {
    it("every read is a 200 for the victim's own viewer, so no 404 above is a mistyped path", async () => {
      const reads = Object.keys(CASES).filter(
        (signature) => signature.startsWith("GET ") && CASES[signature]?.kind === "tenant",
      );

      expect(reads.length).toBeGreaterThanOrEqual(9);

      for (const signature of reads) {
        const path = fillRoute(signature.slice("GET ".length), victim);
        const response = await as(stage.people.viewer, stage.workspace, "get", path);

        expect({ signature, status: response.status }).toEqual({ signature, status: 200 });
      }
    });

    it("the mixed attempt is what catches a dry-run lookup that forgets whose it is", async () => {
      // The negative control: the repository's lookup with its workspace and workflow scoping
      // taken away, as a careless change would leave it. The same request the table sends is
      // then answered — with the victim's run — and the table's two checks both see it.
      const repository = stage.api.nest.get(DryRunsRepository);
      const unscoped = jest
        .spyOn(repository, "find")
        .mockImplementation(async (_org, _workflow, id) => {
          const { rows } = await stage.api.sql.query<DryRun>(
            `select * from ${SCHEMA_NAME}.dry_runs where id = $1`,
            [id],
          );

          return rows[0];
        });

      try {
        const mixed = fillRoute(`${DRY_RUNS}/:dryRunId`, { ...victim, id: other.workflowId });
        const answer = await refusalOf(as(other.owner, other.workspace, "get", mixed), undefined);

        expect(unscoped).toHaveBeenCalledTimes(1);
        expect(answer.status).toBe(200);
        expect(leaks(answer.text, mixed)).not.toEqual([]);
      } finally {
        unscoped.mockRestore();
      }

      // With the scoping back, the line holds again.
      const held = await refusalOf(
        as(
          other.owner,
          other.workspace,
          "get",
          fillRoute(`${DRY_RUNS}/:dryRunId`, { ...victim, id: other.workflowId }),
        ),
        undefined,
      );

      expect(held.status).toBe(404);
    });

    it("the leak detector fires on what the victim's own viewer is told", async () => {
      const conversation = await as(
        stage.people.viewer,
        stage.workspace,
        "get",
        fillRoute(`${COPILOT}/conversation`, victim),
      ).expect(200);
      const suggestions = await as(
        stage.people.viewer,
        stage.workspace,
        "get",
        fillRoute(SUGGESTIONS, victim),
      ).expect(200);

      // With nothing "sent", every id and sentence counts — and the detector finds them.
      expect(leaks(conversation.text, "")).toEqual(
        expect.arrayContaining([victim.id, victim.sessionId, victim.messageId]),
      );
      expect(leaks(suggestions.text, "")).toContain(victim.suggestionId);
    });
  });
});
