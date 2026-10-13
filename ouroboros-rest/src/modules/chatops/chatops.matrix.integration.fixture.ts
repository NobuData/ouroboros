/**
 * The world the `/ouro` integration suites type into (BZ.6,
 * [#540](https://github.com/NobuData/ouroboros/issues/540)), and the command matrix itself.
 *
 * **The world is the development workspace.** A command resolves its arguments against real
 * planes before anything else is decided — `#485` must be a mirrored issue, `1847` a run, `q-3`
 * an open question, `coder-std` a registry alias — so a matrix over every command needs every
 * plane populated at once. The development seeds are exactly that, and they are the product's
 * own picture of itself (mockup 19's `acme-robotics`): a Slack connection for team `T024AB`,
 * Ken linked as its owner, live loops, a queue, open questions, a routing matrix. Nothing here
 * invents a row the seeds already hold.
 *
 * What the seeds do not hold is added the way a person would add it: a **member** and a
 * **viewer**, each linked to a Slack identity by typing `/ouro link` and confirming the page.
 *
 * **Two things outside the service are stood in for**, and nothing inside it:
 *
 * - the **engine** — `scripted-engine.fixture.ts`, reached over HTTP at `OURO_ENGINE_URL` through
 *   a gate ({@link EngineGate}) that can hold a dry run open, so *still running* is a state a
 *   test stands in rather than races;
 * - **GitHub** — a dry run pins a commit first, and {@link pinCommits} answers that one read.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { ACME, ChatBench } from "../../testing/chatops.bench.fixture";
import { ENGINE_STUB_SECRET } from "../../testing/engine.stub.fixture";
import type { Person, Workspace } from "../../testing/harness.fixture";
import { memberOf, SEEDED_WORKSPACE_SLUG } from "../../testing/registry.seed.fixture";
import type { HarnessTeam } from "../../testing/slack.harness.fixture";
import {
  runOf,
  type ScriptedEngine,
  stage,
  startScriptedEngine,
} from "../copilot/certification/scripted-engine.fixture";
import { PinnedCommitReader } from "../dry-runs/dry-runs.commit";
import { ENGINE_DRY_RUNS_ROUTE } from "../engine/engine.dryruns";
import { applyDevSeeds } from "../research/certification/certification.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { CHAT_REPLIES, deniedText } from "./chatops.replies";
import { GRAMMAR } from "./grammar.registry";

/** The seeded Slack workspace (`R__dev_seed_workspace_triage_slack.sql`), as the emitter names it. */
export const SEEDED_TEAM: HarnessTeam = { ...ACME, id: "T024AB" };

/** The seeded loops channel — where every command in these suites is typed. */
export const SEEDED_CHANNEL = "C071LOOPS";

/** Who types, in Slack. */
export const SLACK_USERS = {
  /** Ken — the workspace's owner, linked by the seed. */
  owner: "U07KEN",
  /** A member, linked by {@link startCommandWorld}. */
  member: "U07MEMBER",
  /** A viewer, linked by {@link startCommandWorld}. */
  viewer: "U07VIEWER",
  /** Somebody no link names. */
  nobody: "U07NOBODY",
} as const;

/** A role a matrix cell is typed as. */
export type MatrixRole = "owner" | "member" | "viewer";

/** A surface a command arrives on. */
export type Surface = "slack" | "console";

/** The engine's front door, which can hold dry runs open. */
export interface EngineGate {
  /** Where the application reaches the engine — `OURO_ENGINE_URL`. */
  readonly url: string;
  /** Hold every dry run that arrives from now until {@link release}. */
  hold(): void;
  /** Let held dry runs through, and stop holding. */
  release(): void;
  /** How many dry runs are being held right now. */
  held(): number;
  /** Stop listening. */
  stop(): Promise<void>;
}

/**
 * A pass-through in front of the scripted engine that can hold `POST /v0/dry-runs` open.
 *
 * The scripted engine answers at once, and a dry run that has already ended cannot be observed
 * *running*. Holding the request is the honest way to make the engine slow: the service's own
 * client is waiting on a socket, exactly as it does on a long rehearsal.
 *
 * @param engineUrl - The scripted engine's origin.
 * @returns The gate.
 */
export async function startEngineGate(engineUrl: string): Promise<EngineGate> {
  const target = new URL(engineUrl);
  let holding = false;
  let waiting: (() => void)[] = [];

  const server: Server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];

    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const forward = (): void => {
        const upstream = httpRequest(
          {
            hostname: target.hostname,
            port: target.port,
            path: incoming.url,
            method: incoming.method,
            headers: incoming.headers,
          },
          (answer) => {
            outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
            answer.pipe(outgoing);
          },
        );

        upstream.on("error", () => outgoing.writeHead(502).end());
        upstream.end(Buffer.concat(chunks));
      };

      if (holding && (incoming.url ?? "").endsWith(`/${ENGINE_DRY_RUNS_ROUTE}`)) {
        waiting.push(forward);
      } else {
        forward();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    hold: () => {
      holding = true;
    },
    release: () => {
      holding = false;

      const released = waiting;

      waiting = [];
      for (const forward of released) {
        forward();
      }
    },
    held: () => waiting.length,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** The seeded workspace, the people who type into it, and what stands in for the outside. */
export interface CommandWorld {
  readonly bench: ChatBench;
  readonly engine: ScriptedEngine;
  readonly gate: EngineGate;
  readonly workspace: Workspace;
  /** One signed-in person per role. The member and the viewer are linked in Slack too. */
  readonly people: Readonly<Record<MatrixRole, Person>>;
  /** Stop everything, emptying the database first. */
  close(): Promise<void>;
}

/**
 * Start the application over the seeded workspace, a scripted engine and Slack.
 *
 * @returns The world.
 */
export async function startCommandWorld(): Promise<CommandWorld> {
  const engine = await startScriptedEngine(ENGINE_STUB_SECRET);
  const gate = await startEngineGate(engine.url);
  const bench = await ChatBench.start({ OURO_ENGINE_URL: gate.url });

  await applyDevSeeds(bench.api);

  const [workspace] = await bench.rows<{ id: string; slug: string; name: string }>(
    "organization",
    `"slug" = $1`,
    [SEEDED_WORKSPACE_SLUG],
  );

  if (workspace === undefined) {
    throw new Error(`The development seeds did not create the ${SEEDED_WORKSPACE_SLUG} workspace.`);
  }

  const people = {
    owner: await memberOf(bench.api, workspace, "owner"),
    member: await memberOf(bench.api, workspace, "member"),
    viewer: await memberOf(bench.api, workspace, "viewer"),
  };

  await bench.link(SEEDED_TEAM, SLACK_USERS.member, people.member);
  await bench.link(SEEDED_TEAM, SLACK_USERS.viewer, people.viewer);
  bench.slack.replies.length = 0;

  return {
    bench,
    engine,
    gate,
    workspace,
    people,
    close: async () => {
      gate.release();
      await bench.reset();
      await bench.close();
      await gate.stop();
      await engine.stop();
    },
  };
}

/**
 * Answer the one GitHub read a dry run makes — the commit it pins — for the current test.
 *
 * `restoreMocks` puts the real reader back when the test ends.
 *
 * @param world - The world.
 */
export function pinCommits(world: CommandWorld): void {
  jest.spyOn(world.bench.api.nest.get(PinnedCommitReader), "pin").mockResolvedValue({
    slug: "acme-robotics/helios-firmware",
    sha: "a".repeat(40),
    token: "bz6-not-a-github-token",
  });
}

/**
 * Script the engine's next dry run to complete cleanly.
 *
 * @param world - The world.
 */
export function scriptCleanDryRun(world: CommandWorld): void {
  world.engine.scriptRun((wire) => runOf(wire, [stage(1, "implement")], { status: "complete" }));
}

/**
 * Take an issue out of the seeded queue, so it can be queued.
 *
 * @param world - The world.
 * @param issueNumber - The issue.
 */
async function unqueue(world: CommandWorld, issueNumber: number): Promise<void> {
  await world.bench.api.sql.query(
    `delete from ouroboros.queue_items where organization_id = $1 and issue_number = $2`,
    [world.workspace.id, issueNumber],
  );
}

/**
 * Lift the workspace's pause through its own route, as an owner does in Settings.
 *
 * @param world - The world.
 */
export async function resumeWorkspace(world: CommandWorld): Promise<void> {
  await world.bench.api
    .as(world.people.owner)("post", "/api/v1/settings/lifecycle/resume")
    .set(TENANT_HEADER, world.workspace.slug)
    .send({})
    .expect(200);
}

/* ------------------------------------------------------------------ the matrix */

/** A cell that cannot exist, and why. */
export interface NotApplicable {
  readonly notApplicable: string;
}

/** A command that runs. */
export interface OkCell {
  /** What is typed after `/ouro`. */
  readonly text: string;
  /** What it answers at once. */
  readonly reply: string | RegExp;
  /** For an async command: what its result says when it settles. */
  readonly settles?: RegExp;
  /** What must be true first that the seeds do not make true. */
  readonly arrange?: (world: CommandWorld) => Promise<void> | void;
  /** What to put back afterwards, so the next cell finds the world as seeded. */
  readonly restore?: (world: CommandWorld) => Promise<void>;
}

/** A command that is refused for what was typed. */
export interface RefusedCell {
  /** What is typed after `/ouro`. */
  readonly text: string;
  /** What it answers. */
  readonly reply: string | RegExp;
}

/** One command's row. */
export interface MatrixRow {
  /** It runs — on each surface, against the real plane. */
  readonly ok: Readonly<Record<Surface, OkCell>>;
  /** Somebody whose role is not enough types it, with arguments that resolve. */
  readonly denied: { readonly as: MatrixRole; readonly text: string } | NotApplicable;
  /** Arguments that are missing, extra, or name nothing. */
  readonly badArguments: RefusedCell;
  /** A destructive command typed without `confirm`. */
  readonly confirmRequired: (RefusedCell & { readonly confirmWith: string }) | NotApplicable;
}

/** Why a command every member may run has no `denied` cell. */
const EVERY_MEMBER: NotApplicable = {
  notApplicable:
    "every workspace member may run it — and somebody who has left is unlinked in Slack and " +
    "refused by the tenant guard in the console, which the suite holds separately",
};

/** Why a command that destroys nothing has no confirm prompt. */
const NOT_DESTRUCTIVE: NotApplicable = {
  notApplicable: "not destructive — it has no confirm word",
};

/** A control request's acknowledgement. */
const requested = (title: string, loop: number): RegExp =>
  new RegExp(`^${title} requested for loop ${String(loop)} — `);

/** What a dry run says at once, and when it settles. */
const DRY_RUN_STARTED = /^Dry run started — no writes, no PRs\./;
const dryRunSettled = (issue: number): RegExp =>
  new RegExp(`^Dry run of security-patch on #${String(issue)} complete · `);

/**
 * Every command of the grammar × every way it can end.
 *
 * **Keyed by command id, and held to the registry**: the suite fails when the registry lists a
 * command this table does not, and when this table lists one the registry does not. `unlinked`
 * has no column — it is the same for every command (decided before the command is even looked
 * up), exists only in Slack, and the suite runs it for each row with the row's own text.
 *
 * Every `ok` cell is the real plane's own answer. Where the two surfaces would consume the same
 * thing — one issue to queue, one question to answer — each has a subject of its own.
 */
export const MATRIX: Readonly<Record<string, MatrixRow>> = {
  status: {
    ok: {
      slack: { text: "status", reply: /^\d+ loops live · \d+ queued · farm \d+\/\d+ online · / },
      console: { text: "status", reply: /^\d+ loops live · \d+ queued · farm \d+\/\d+ online · / },
    },
    denied: EVERY_MEMBER,
    badArguments: {
      text: "status now",
      reply: '`/ouro status` has nowhere to put "now" — usage: `/ouro status`',
    },
    confirmRequired: NOT_DESTRUCTIVE,
  },
  queue: {
    ok: {
      // #484 is the one sized issue the seeds leave out of the queue.
      slack: { text: "queue #484", reply: /^queued at position \d+ \(pinned standard-fix@v\d+\)$/ },
      console: {
        text: "queue #485 feature-loop",
        reply: /^queued at position \d+ \(pinned feature-loop@v\d+\)$/,
        arrange: (world) => unqueue(world, 485),
      },
    },
    denied: { as: "viewer", text: "queue #484" },
    badArguments: { text: "queue #999", reply: "ticket: no issue #999 in this workspace" },
    confirmRequired: NOT_DESTRUCTIVE,
  },
  "pause loop": {
    ok: {
      slack: { text: "pause loop 1847", reply: requested("Pause", 1847) },
      console: { text: "pause loop #1844", reply: requested("Pause", 1844) },
    },
    denied: { as: "member", text: "pause loop 1847" },
    badArguments: { text: "pause loop x", reply: /^"x" is not a loop number — use the number/ },
    confirmRequired: NOT_DESTRUCTIVE,
  },
  "resume loop": {
    ok: {
      slack: { text: "resume loop 1847", reply: requested("Resume", 1847) },
      console: { text: "resume loop 1844", reply: requested("Resume", 1844) },
    },
    denied: { as: "member", text: "resume loop 1847" },
    badArguments: {
      text: "resume loop",
      reply: "`/ouro resume loop` needs a loop — usage: `/ouro resume loop <loop>`",
    },
    confirmRequired: NOT_DESTRUCTIVE,
  },
  "abort loop": {
    ok: {
      slack: { text: "abort loop 1841 confirm", reply: requested("Abort", 1841) },
      console: { text: "abort loop 1844 confirm", reply: requested("Abort", 1844) },
    },
    // Refused for the role even with the word: `confirm` is not a way round the permission.
    denied: { as: "member", text: "abort loop 1841 confirm" },
    badArguments: {
      text: "abort loop 1841 yes",
      reply:
        '`/ouro abort loop` takes the word `confirm` where "yes" was typed — usage: `/ouro abort loop <loop> confirm`',
    },
    confirmRequired: {
      text: "abort loop 1841",
      reply:
        "Add `confirm` to abort — this stops loop 1841 for good and closes its run as canceled. Its branch is kept; nothing is reverted or deleted. `/ouro abort loop 1841 confirm`",
      confirmWith: "abort loop 1841 confirm",
    },
  },
  answer: {
    ok: {
      slack: {
        text: "answer q-3 require_bench_upgrade",
        reply: /^q-3 answered with require_bench_upgrade — /,
      },
      // A merge is answered signed in, which the console is — and Slack, the suite holds, is not.
      console: {
        text: "answer q-1 approve_merge",
        reply: /^q-1 answered with approve_merge — approval recorded/,
      },
    },
    denied: EVERY_MEMBER,
    badArguments: {
      text: "answer q-999 allow_once",
      reply: /^no question q-999 in this workspace/,
    },
    confirmRequired: NOT_DESTRUCTIVE,
  },
  "dry-run": {
    ok: {
      slack: {
        text: "dry-run #486 security-patch",
        reply: DRY_RUN_STARTED,
        settles: dryRunSettled(486),
        arrange: (world) => {
          pinCommits(world);
          scriptCleanDryRun(world);
        },
      },
      console: {
        // The alias, and the one seeded issue with a synced ticket again: a rehearsal writes nothing.
        text: "dryrun #486 security-patch",
        reply: DRY_RUN_STARTED,
        settles: dryRunSettled(486),
        arrange: (world) => {
          pinCommits(world);
          scriptCleanDryRun(world);
        },
      },
    },
    denied: { as: "viewer", text: "dry-run #486 security-patch" },
    badArguments: { text: "dry-run #486 nope", reply: /^unknown workflow "nope" — try: / },
    confirmRequired: NOT_DESTRUCTIVE,
  },
  route: {
    ok: {
      slack: {
        text: "route implement coder-std",
        reply: /^implement now routes to coder-std \(.+\) — was coder-max\.$/,
      },
      console: {
        text: "route review coder-std",
        reply: /^review now routes to coder-std \(.+\) — was coder-max\.$/,
      },
    },
    denied: { as: "member", text: "route implement coder-std" },
    badArguments: { text: "route nope coder-max", reply: /^unknown task kind "nope" — try: / },
    confirmRequired: NOT_DESTRUCTIVE,
  },
  "explain pr": {
    // `v2`: listed, and answered honestly — the same sentence for everybody, and nothing runs.
    ok: {
      slack: {
        text: "explain pr 514",
        reply: /^Plain-language PR summaries arrive with AI presence/,
      },
      console: {
        text: "explain pr #514",
        reply: /^Plain-language PR summaries arrive with AI presence/,
      },
    },
    denied: EVERY_MEMBER,
    badArguments: {
      text: "explain pr x",
      reply: 'pr: "x" is not a pull request number — like 514',
    },
    confirmRequired: NOT_DESTRUCTIVE,
  },
  estimate: {
    ok: {
      slack: { text: "estimate #485", reply: /^#485 — effort M · cycle \d+–\d+ min · / },
      console: { text: "estimate #490", reply: /^#490 — effort XL · cycle \d+–\d+ min · / },
    },
    denied: EVERY_MEMBER,
    badArguments: {
      text: "estimate nope",
      reply: '"nope" is not a ticket — use #485, repo#485, owner/repo#485 or a GitHub issue URL',
    },
    confirmRequired: NOT_DESTRUCTIVE,
  },
  "pause all": {
    ok: {
      slack: {
        text: "pause all confirm",
        reply: /^All loops are paused\./,
        restore: resumeWorkspace,
      },
      console: {
        text: "pause all confirm",
        reply: /^All loops are paused\./,
        restore: resumeWorkspace,
      },
    },
    denied: { as: "member", text: "pause all confirm" },
    badArguments: {
      text: "pause all now",
      reply:
        '`/ouro pause all` takes the word `confirm` where "now" was typed — usage: `/ouro pause all confirm`',
    },
    confirmRequired: {
      text: "pause all",
      reply:
        "Add `confirm` to pause everything — this stops every loop in Acme Robotics from starting anything new. Stages already running finish, and queued work stays queued until an owner or admin resumes the workspace. `/ouro pause all confirm`",
      confirmWith: "pause all confirm",
    },
  },
};

/**
 * What somebody whose role is not enough is told for a command — the dispatcher's own sentence.
 *
 * @param id - The command.
 * @returns `` `/ouro route` is for workspace owners and admins. ``
 */
export function deniedReply(id: string): string {
  const definition = GRAMMAR.commands.find((command) => command.id === id);

  if (definition === undefined) {
    throw new Error(`The grammar has no command "${id}".`);
  }

  return deniedText(definition);
}

/** What somebody unlinked is told, whatever they typed. */
export const UNLINKED_REPLY = CHAT_REPLIES.unlinked;
