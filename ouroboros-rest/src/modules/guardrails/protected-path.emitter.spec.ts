import { Logger } from "@nestjs/common";

import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { MOCKUP_PROSE, SHIPPED_KINDS } from "../decisions/decision.kinds.fixture";
import { registryHarness, type RegistryHarness } from "../decisions/decision.store.fixture";
import { renderDecision } from "../decisions/decision.templates";
import { DecisionSourceWatcher } from "../decisions/decision.watchers";
import {
  ProtectedPathEmitter,
  RUN_ENDED_STATUSES,
  editSummary,
  protectedPathEmission,
} from "./protected-path.emitter";

/**
 * The protected-path emitter (#461, AP.3): a refused protected path becomes *"Allow a one-time edit
 * to a protected path?"* with its diff context, one card per run and path however often AP.3
 * evaluates.
 */

const ORG = "acme-robotics";
const RUN = "0a1b2c3d-0000-4000-8000-000000001851";
const TICKET = "0a1b2c3d-0000-4000-8000-000000000479";
const PATH = "boot/rollback_flag.c";

describe("editSummary", () => {
  it("says what the edit does, in the card's words", () => {
    expect(editSummary(1, 0)).toBe("add one line");
    expect(editSummary(3, 0)).toBe("add three lines");
    expect(editSummary(0, 2)).toBe("remove two lines");
    expect(editSummary(10, 4)).toBe("change 14 lines");
  });
});

describe("protectedPathEmission", () => {
  it("composes mockup 16's second card, keyed by run and path", () => {
    const emission = protectedPathEmission({
      run: {
        runId: RUN,
        organizationId: ORG,
        subject: "The OTA rollback fix",
        stageLabel: "Code",
        refs: [
          { type: "run", id: RUN, label: "loop #1851" },
          { type: "ticket", id: TICKET, label: "issue #479" },
        ],
      },
      path: PATH,
      additions: 1,
      deletions: 0,
    });

    expect(emission.key).toEqual({ plane: "guardrails", sourceRef: `run:${RUN}:path:${PATH}` });
    expect(emission.refs.at(-1)).toEqual({ type: "path", id: PATH, label: PATH });
    expect(
      renderDecision(SHIPPED_KINDS.protected_path_allow_once, {
        ...emission.payload,
        diff_lines: 3,
      }),
    ).toEqual(MOCKUP_PROSE.protected_path_allow_once);
  });

  it("clips a long subject to the kind's limit and never claims a zero-line diff", () => {
    const emission = protectedPathEmission({
      run: {
        runId: RUN,
        organizationId: ORG,
        subject: "x".repeat(300),
        stageLabel: "Code",
        refs: [],
      },
      path: PATH,
      additions: 0,
      deletions: 0,
    });

    expect([...String(emission.payload.subject)]).toHaveLength(120);
    expect(emission.payload.diff_lines).toBe(1);
  });
});

describe("ProtectedPathEmitter.verdictFailed", () => {
  let harness: RegistryHarness;
  let database: RecordingDatabase;

  /** Queue the reads of one refusal: the verdict, the run, its ticket and the file's diff stat. */
  function refusal(detail = "1 path inside a protected path.") {
    database.answers(
      { rows: [{ verdict: "fail", evidence: { path: PATH, glob: "boot/**", detail } }] },
      {
        rows: [
          {
            id: RUN,
            organization_id: ORG,
            loop_seq: 1851,
            issue_title: "The OTA rollback fix",
            stage_label: "Code",
          },
        ],
      },
      { rows: [{ id: TICKET, external_key: "#479" }] },
      { rows: [{ additions: 1, deletions: 0 }] },
    );
  }

  beforeEach(() => {
    harness = registryHarness();
    database = recordingDatabase();
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("files one card however often AP.3 evaluates the stage — three evaluations, one item", async () => {
    const emitter = new ProtectedPathEmitter(database.service, harness.registry);

    refusal();
    await emitter.verdictFailed(RUN);
    refusal();
    await emitter.verdictFailed(RUN);
    refusal();
    await emitter.verdictFailed(RUN);

    expect(harness.store.items).toHaveLength(1);
    expect(harness.store.items[0]).toMatchObject({
      kindId: "protected_path_allow_once",
      severity: "warn",
      payload: {
        subject: "The OTA rollback fix",
        edit_summary: "add one line",
        path: PATH,
        diff_lines: 1,
      },
      refs: [
        { type: "run", id: RUN, label: "loop #1851" },
        { type: "ticket", id: TICKET, label: "issue #479" },
        { type: "path", id: PATH, label: PATH },
      ],
    });
    expect(harness.audit.map((record) => record.action)).toEqual(["decision.filed"]);
  });

  it("files nothing for an out-of-scope refusal or a passing verdict — nobody is asked for those", async () => {
    const emitter = new ProtectedPathEmitter(database.service, harness.registry);

    database.answers({
      rows: [
        {
          verdict: "fail",
          evidence: {
            path: "src/x.c",
            glob: "drivers/**",
            detail: "1 path outside the plan's scope.",
          },
        },
      ],
    });
    await emitter.verdictFailed(RUN);
    database.answers({ rows: [{ verdict: "pass", evidence: { detail: "ok" } }] });
    await emitter.verdictFailed(RUN);

    expect(harness.store.items).toEqual([]);
  });

  it("never throws, so a committed report is never failed by its card", async () => {
    const emitter = new ProtectedPathEmitter(
      {
        db: {
          selectFrom: () => {
            throw new Error("down");
          },
        },
      } as never,
      harness.registry,
    );

    await expect(emitter.verdictFailed(RUN)).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it("registers a run-ended detector that leaves a needs_human run asking", () => {
    const watcher = new DecisionSourceWatcher(harness.store.asRepository(), harness.registry);
    const register = jest.spyOn(watcher, "register");

    new ProtectedPathEmitter(database.service, harness.registry, watcher).onModuleInit();

    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: ["protected_path_allow_once"] }),
    );
    expect(RUN_ENDED_STATUSES).toEqual(["merged", "failed", "canceled"]);
  });
});
