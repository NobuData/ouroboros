import type { EngineClient } from "../engine/engine.client";
import { engineUnavailable } from "../engine/engine.errors";
import { completeScript, FakeEngine, FakeRunStore } from "./analysis.fixture";
import { AnalysisOrchestrator } from "./analysis.orchestrator";
import type { AnalysisRepository } from "./analysis.repository";
import type { ComposeRun, SuggestionComposer } from "./composer/composer.service";
import type { ComposeWindow } from "./composer/composer.types";
import { CorpusAssembler } from "./corpus/corpus.assembler";
import { FakeCorpusRepository, mockupCorpus, ORG, REPO } from "./corpus/corpus.fixture";
import type { CorpusRepository } from "./corpus/corpus.repository";

/** A composer that records what it was asked, and what the run's status was when it was. */
class FakeComposer {
  readonly calls: { run: ComposeRun; window: ComposeWindow; status: string | undefined }[] = [];
  failWith?: Error;

  constructor(private readonly store: FakeRunStore) {}

  compose(run: ComposeRun, window: ComposeWindow) {
    this.calls.push({ run, window, status: this.store.rows.get(run.id)?.status });
    return this.failWith === undefined
      ? Promise.resolve({ recorded: ["s1", "s2"], failed: [] })
      : Promise.reject(this.failWith);
  }
}

function harness() {
  const store = new FakeRunStore();
  const corpus = new FakeCorpusRepository(mockupCorpus());
  const engine = new FakeEngine();
  const composer = new FakeComposer(store);
  const orchestrator = new AnalysisOrchestrator(
    store as unknown as AnalysisRepository,
    corpus as unknown as CorpusRepository,
    new CorpusAssembler(corpus as unknown as CorpusRepository),
    engine as unknown as EngineClient,
    () => Date.UTC(2026, 7, 8, 13, 0, 0),
    composer as unknown as SuggestionComposer,
  );

  return { store, engine, composer, orchestrator };
}

async function runToEnd(orchestrator: AnalysisOrchestrator): Promise<string> {
  const run = await orchestrator.start({ organizationId: ORG, repoRef: REPO, trigger: "manual" });
  await orchestrator.idle();
  return run.id;
}

/** BV.4 (#513): the composing phase composes, and composition never decides a run's outcome. */
describe("the composing phase", () => {
  it("composes the run's suggestions while it is still running, over the corpus window", async () => {
    const { orchestrator, engine, composer, store } = harness();
    engine.script = completeScript();

    const id = await runToEnd(orchestrator);

    expect(composer.calls).toHaveLength(1);
    expect(composer.calls[0].run.id).toBe(id);
    expect(composer.calls[0].status).toBe("running");
    expect(composer.calls[0].window).toMatchObject({ days: 90 });
    expect(store.rows.get(id)?.status).toBe("complete");
  });

  it("still composes the findings that were kept when the ceiling stopped the run", async () => {
    const { orchestrator, engine, composer, store } = harness();
    engine.script = completeScript({}, true);

    const id = await runToEnd(orchestrator);

    expect(composer.calls).toHaveLength(1);
    expect(store.rows.get(id)?.status).toBe("budget_exceeded");
  });

  it("completes the run when composition breaks — the findings stand on their own", async () => {
    const { orchestrator, engine, composer, store } = harness();
    engine.script = completeScript();
    composer.failWith = new Error("the composer broke");

    const id = await runToEnd(orchestrator);

    expect(composer.calls).toHaveLength(1);
    expect(store.rows.get(id)?.status).toBe("complete");
    expect(store.rows.get(id)?.failure_reason).toBeNull();
  });

  it("composes nothing for a run that failed", async () => {
    const { orchestrator, engine, composer, store } = harness();
    engine.script = completeScript().slice(0, 2);
    engine.breakWith = engineUnavailable();

    const id = await runToEnd(orchestrator);

    expect(store.rows.get(id)?.status).toBe("failed");
    expect(composer.calls).toEqual([]);
  });
});
