/**
 * The in-process work queue — how many issues are sized at once, and how a duplicate is
 * dropped.
 *
 * L.3 ([#107](https://github.com/NobuData/ouroboros/issues/107)). Two of the ticket's
 * acceptance criteria are this file rather than the orchestrator's:
 *
 *   * *"Bounded concurrency is enforced — a large backlog does not open one engine connection
 *     per issue."*
 *   * *"Concurrent estimation of the same issue produces sequential versions with no
 *     deadlock."* — the half of it that is *this process's*, which is that a second request
 *     for an issue already in flight is dropped rather than raced. The other half is the
 *     database's, and `estimation.repository.ts` carries it.
 *
 * **A class rather than `chunked()`.** `scheduling/cadence.ts` bounds the backlog sync's
 * concurrency by awaiting one chunk before starting the next, and that is the right shape
 * there: a cycle has a whole interval to finish in, and the list is known when it starts. This
 * queue's list is not — it is fed by a poll, by a sweep and, when L.4
 * ([#108](https://github.com/NobuData/ouroboros/issues/108)) lands, by a person pressing a
 * button — so work arrives while work is running, and a chunked loop would make a single slow
 * estimate hold up the four that arrived behind it. What that costs is the scheduler below;
 * what it buys is a pipe that stays full and a queue something can be *added to*.
 *
 * **Dedupe is by issue id and covers both states.** An issue that is waiting and an issue that
 * is running are both *already claimed by this process*, and admitting a second copy of either
 * would spend an engine call to write a version identical to the one being written. So
 * {@link EstimationQueue.admit} answers `false` for both, and its callers count that rather
 * than ignoring it — a sweep that keeps re-queueing work already in flight is a sweep whose
 * threshold is set wrong, and the count is how anyone would know.
 *
 * **There is deliberately no depth cap.** A cap would have to drop work, and a dropped issue
 * stays `unsized` with nothing scheduled to notice — silent, which is the one failure mode
 * this ticket exists to prevent. What is held per waiting issue is an id and a reason; a
 * hundred thousand of them is a few megabytes, and the backlog sync's own per-poll cap is what
 * bounds how fast they arrive.
 *
 * **Nothing here touches the database, the engine or the clock.** It is a scheduler over
 * functions, which is what lets `estimation.queue.spec.ts` assert the bound by resolving
 * promises in an order it chooses rather than by timing anything.
 */

/** One unit of work: an issue to size, and the function that sizes it. */
export interface QueuedEstimation {
  /**
   * `github_issues.id` — the dedupe key.
   *
   * The issue rather than the workspace, because two issues in one workspace are two
   * independent estimates and only the *same* issue twice is a duplicate.
   */
  readonly issueId: string;
  /**
   * Size it.
   *
   * @returns When the issue has reached a terminal status. **It must not reject**: the queue
   *   has nowhere to report a failure to — its callers are a timer and a committed
   *   transaction — so failure handling belongs to the orchestrator, which owns the status
   *   the failure has to be written as. {@link EstimationQueue} logs nothing and swallows
   *   nothing; see {@link EstimationQueue.pump}.
   */
  run(): Promise<void>;
}

/**
 * A FIFO queue that runs at most N of its jobs at once and holds each issue only once.
 *
 * Not `@Injectable()`: it is constructed by {@link EstimationOrchestrator} with a bound read
 * from configuration, and a provider would be a second place that bound could come from.
 */
export class EstimationQueue {
  /** Waiting work, oldest first. */
  private readonly waiting: QueuedEstimation[] = [];

  /**
   * The issues this queue holds — waiting *and* running.
   *
   * One set for both states rather than one per state, because the question every caller asks
   * is *"is this process already dealing with that issue"* and the answer must not depend on
   * which half of its life it happens to be in when the question is asked.
   */
  private readonly claimed = new Set<string>();

  /** How many jobs are running right now. Never above {@link concurrency}. */
  private running = 0;

  /**
   * Everyone waiting for the queue to empty, and how to tell them.
   *
   * A list rather than one promise, so two callers may wait at once — which is exactly what a
   * spec that drains between assertions does, and what a shutdown that overlaps a test's own
   * wait would do.
   */
  private readonly idleWaiters: (() => void)[] = [];

  /**
   * @param concurrency - How many jobs may run at once. Validated by the configuration schema
   *   to be at least 1; clamped here anyway, because a queue whose bound is 0 accepts work
   *   and never runs any of it, which is the one failure this class must not be able to have.
   */
  constructor(private readonly concurrency: number) {
    this.concurrency = Math.max(1, concurrency);
  }

  /**
   * Take work, unless this issue is already here.
   *
   * @param job - The issue and how to size it.
   * @returns `true` when it was queued, `false` when the issue is already waiting or running.
   *   Callers report the `false`s as a count rather than discarding them — see this file's
   *   header.
   */
  admit(job: QueuedEstimation): boolean {
    if (this.claimed.has(job.issueId)) {
      return false;
    }

    this.claimed.add(job.issueId);
    this.waiting.push(job);
    this.pump();

    return true;
  }

  /** How many issues are waiting to start. */
  get depth(): number {
    return this.waiting.length;
  }

  /** How many issues are being sized right now. */
  get active(): number {
    return this.running;
  }

  /** Whether this queue holds no work at all, in either state. */
  get idle(): boolean {
    return this.running === 0 && this.waiting.length === 0;
  }

  /**
   * Is this issue already waiting or running here?
   *
   * @param issueId - `github_issues.id`.
   * @returns `true` when {@link admit} would refuse it.
   */
  holds(issueId: string): boolean {
    return this.claimed.has(issueId);
  }

  /**
   * When there is nothing left to do.
   *
   * For a shutdown that would rather let in-flight work finish, and for the specs and the
   * integration suite, which need a moment at which asserting the database is not a race.
   *
   * @returns A promise that settles once the queue is empty and nothing is running. Resolves
   *   immediately when it already is. Never rejects — a job's own failure is the
   *   orchestrator's, and a caller waiting for quiet is not the place to learn about one.
   */
  async settled(): Promise<void> {
    if (this.idle) {
      return;
    }

    return new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  /**
   * Start as much waiting work as the bound allows.
   *
   * Called on every admission and after every completion, which is what makes the pipe refill
   * the instant a slot opens rather than at the end of a batch.
   */
  private pump(): void {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      // `shift()` cannot return undefined here — the loop condition just read a non-zero
      // length — but the fallback keeps that a fact the compiler checks rather than one a
      // reader has to verify.
      const job = this.waiting.shift();

      if (job === undefined) {
        return;
      }

      this.running += 1;

      // Deliberately not awaited: this method's job is to *start* work, and awaiting here
      // would make the loop sequential and the bound meaningless. A job is documented not to
      // reject; `catch` is here because "documented" is not "enforced", and a rejection that
      // escaped would take the slot with it and shrink the queue's capacity by one for the
      // life of the process.
      void job
        .run()
        .catch(() => undefined)
        .finally(() => {
          this.finish(job.issueId);
        });
    }
  }

  /**
   * One job is over: release its slot, its claim, and anyone waiting for quiet.
   *
   * @param issueId - The issue that finished.
   */
  private finish(issueId: string): void {
    this.running -= 1;
    this.claimed.delete(issueId);

    this.pump();

    if (!this.idle) {
      return;
    }

    // Drained rather than iterated: a waiter's callback may admit more work — which is what a
    // spec asserting the queue can be reused does — and resolving out of a list this method
    // is still walking would be a resolve against a queue that is no longer idle.
    const waiters = this.idleWaiters.splice(0, this.idleWaiters.length);

    for (const resolve of waiters) {
      resolve();
    }
  }
}
