/**
 * The conformance kit's write suites — what every write-capable `TicketSourceProvider` has to pass
 * before a push service is allowed to point at it.
 *
 * AL.2 ([#278](https://github.com/NobuData/ouroboros/issues/278)), extending Q.5's kit
 * ([#142](https://github.com/NobuData/ouroboros/issues/142)). A provider author adds one call
 * beside the read suite:
 *
 * ```ts
 * describeTicketSourceWriteConformance("JiraTicketSourceProvider", () => ({
 *   provider, context, drafts, milestoneName, epic, ledger, refuse, recover,
 * }));
 * ```
 *
 * ```
 * describeTicketSourceWriteConformance(provider, recordings)
 *   ├─ declaration      coherent · agrees with the five members
 *   ├─ create           a ref a sync could adopt · one ticket per call
 *   ├─ dedupe           the same idempotency key twice → one ticket, the same ref
 *   ├─ link             native or documented fallback, as declared · twice → one relation
 *   ├─ milestones       twice → one milestone · null when not declared
 *   ├─ epics            twice → one container · attach twice → one membership · none → null
 *   ├─ error taxonomy   auth · permission · validation · rate_limit · not_found · upstream
 *   └─ rollback         a refused write leaves nothing behind · the retry creates exactly one
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Why the harness supplies a ledger.** Idempotency is a claim about the *tracker* — one
 * milestone exists, not *the provider answered the same reference twice*. A provider that created
 * a second milestone and returned the first one's id would pass a check on answers alone. So the
 * harness reports what its recording holds, read the way a person would count it in the tracker,
 * and the kit compares counts before and after. An HTTP provider's ledger is its stand-in
 * client's record of `POST`s; the in-memory fake's is the tracker's own state.
 *
 * **Why the rules are functions returning sentences**, as in the read kit: each one is a test
 * subject in `conformance.write.fixture.spec.ts`, watched failing against a provider built to break
 * it, and one run reports every problem at once.
 *
 * **Every case builds a fresh harness**, so a refusal arranged in one cannot leak into the next.
 *
 * It is a `.fixture.ts`: type-checked with the code it gates, left out of the image by
 * `tsconfig.build.json`, and held to the fake by `ticket-source-core-tests-run-on-the-fake`.
 */

import {
  CANONICAL_LIMITS,
  CANONICAL_URL,
  describeThrown,
  retentionViolations,
  settle,
  type Settled,
} from "./conformance.fixture";
import {
  MAX_STATUS_REASON,
  TICKET_SOURCE_WRITE_ERROR_CLASSES,
  TicketSourceError,
  statusReasonFor,
  type TicketSourceErrorClass,
} from "./ticket-source.errors";
import {
  supportsWrites,
  writeMemberViolations,
  type TicketSourceProvider,
  type TicketSyncContext,
  type WriteCapableProvider,
} from "./ticket-source.provider";
import type {
  DependencyLinkResult,
  EpicContainerInput,
  EpicMirrorRef,
  TicketDraftInput,
  TicketWriteRef,
} from "./ticket-source.write";

/**
 * What a recording holds that a write could have changed, counted as a person would count it in
 * the tracker. See this file's header.
 *
 * Identities are the tracker's own — the same strings the provider's references carry — so the kit
 * can say *which* relation is missing rather than only that a count is off.
 */
export interface WriteLedger {
  /** Every ticket's `externalId`. */
  readonly tickets: readonly string[];
  /** Every dependency, native or fallback, as `[blockerExternalId, blockedExternalId]`. */
  readonly dependencies: readonly (readonly [string, string])[];
  /** Every milestone's `externalRef`. */
  readonly milestones: readonly string[];
  /** Every epic container's `externalRef`. */
  readonly containers: readonly string[];
  /** Every membership, as `[containerExternalRef, ticketExternalId]`. */
  readonly memberships: readonly (readonly [string, string])[];
}

/** Everything the write suites need from a provider author. */
export interface TicketSourceWriteConformance {
  /** The provider under test. Must declare `write.createTicket`. */
  readonly provider: TicketSourceProvider;
  /**
   * The source the writes run against. Its credential is searched for in every detail and in the
   * provider's own fields, so it must be distinctive.
   */
  readonly context: TicketSyncContext;
  /**
   * Two drafts the recording accepts, with **different** idempotency keys — the link case needs a
   * blocker and a blocked ticket.
   */
  readonly drafts: readonly [TicketDraftInput, TicketDraftInput];
  /** A milestone name the recording accepts. */
  readonly milestoneName: string;
  /** An epic the recording accepts. */
  readonly epic: EpicContainerInput;
  /** What the recording holds right now. */
  readonly ledger: () => WriteLedger;
  /**
   * One arranger per class: after it runs, **every** write meets a recorded refusal of that class.
   * A total record over all six, so a push failure of any class is seen to be classified.
   */
  readonly refuse: Readonly<Record<TicketSourceErrorClass, () => void>>;
  /** Undo whatever {@link refuse} arranged — the tracker answering again. */
  readonly recover: () => void;
}

/**
 * Everything wrong with a reference a write member answered.
 *
 * @param ref - What the provider answered. `unknown`, for the read kit's reason.
 * @param at - What to prefix every sentence with.
 * @returns The violations. Empty means a sync could adopt the ticket it names.
 */
export function writeRefViolations(ref: unknown, at: string): string[] {
  if (typeof ref !== "object" || ref === null || Array.isArray(ref)) {
    return [`${at}: must answer { externalId, externalKey, url }`];
  }

  const { externalId, externalKey, url } = ref as Record<string, unknown>;
  const violations: string[] = [];

  for (const [field, value, max] of [
    ["externalId", externalId, CANONICAL_LIMITS.externalId],
    ["externalKey", externalKey, CANONICAL_LIMITS.externalKey],
  ] as const) {
    if (typeof value !== "string" || value.trim() === "" || value.length > max) {
      violations.push(
        `${at}: ${field} must be non-blank text of at most ${max.toString()} characters — the ` +
          "ticket a sync adopts carries the same identity",
      );
    }
  }

  if (
    typeof url !== "string" ||
    url.length > CANONICAL_LIMITS.externalUrl ||
    !CANONICAL_URL.test(url)
  ) {
    violations.push(`${at}: url must be an https link with a host`);
  }

  return violations;
}

/**
 * Everything wrong with how a write failed.
 *
 * @param settled - How the write ended.
 * @param expected - The class the recording was arranged to produce.
 * @param credentials - The credential the write was made with.
 * @param at - What to prefix every sentence with.
 * @returns The violations.
 */
export function writeFailureViolations(
  settled: Settled<unknown>,
  expected: TicketSourceErrorClass,
  credentials: string | null,
  at: string,
): string[] {
  if (settled.resolved) {
    return [`${at}: the ${expected} recording answered instead of failing`];
  }

  const { error } = settled;

  if (!TicketSourceError.is(error)) {
    return [
      `${at}: a failed write must reject with a TicketSourceError, not ${describeThrown(error)} — ` +
        "a push failure has to be classifiable",
    ];
  }

  const violations: string[] = [];

  if (error.errorClass !== expected) {
    violations.push(`${at}: the ${expected} recording was classified ${error.errorClass}`);
  }

  if (credentials !== null && credentials !== "" && error.detail.includes(credentials)) {
    violations.push(`${at}: the error's detail contains the credential`);
  }

  const reason = statusReasonFor(error);

  if (reason.trim() === "" || reason.length > MAX_STATUS_REASON) {
    violations.push(
      `${at}: the reason must be non-blank and at most ${MAX_STATUS_REASON.toString()} characters`,
    );
  }

  return violations;
}

/**
 * Everything wrong between two ledgers, given what one step was allowed to add.
 *
 * @param before - The ledger before the step.
 * @param after - The ledger after it.
 * @param allowed - How many entries of each kind the step may add. Absent kinds may add none.
 * @param at - What to prefix every sentence with.
 * @returns One sentence per kind whose count moved by anything else.
 */
export function ledgerGrowthViolations(
  before: WriteLedger,
  after: WriteLedger,
  allowed: Partial<Record<keyof WriteLedger, number>>,
  at: string,
): string[] {
  const kinds: readonly (keyof WriteLedger)[] = [
    "tickets",
    "dependencies",
    "milestones",
    "containers",
    "memberships",
  ];

  return kinds.flatMap((kind) => {
    const grew = after[kind].length - before[kind].length;
    const expected = allowed[kind] ?? 0;

    return grew === expected
      ? []
      : [
          `${at}: ${kind} grew by ${grew.toString()}, expected ${expected.toString()} — ` +
            "a retried write must not create a second one",
        ];
  });
}

/**
 * Everything wrong with the modes `linkDependency` answered, given the declaration.
 *
 * One direction only, and deliberately: a provider declaring no native relations must never answer
 * `native` — the UI would tell a person the tracker holds a relation it does not — and every answer
 * must be one of the two modes. A provider declaring native relations may answer `fallback` when a
 * probe finds its tracker instance without them (see `DependencyLinkResult.mode`); the ledger check
 * beside this one is what proves the fallback really recorded the relation.
 *
 * @param nativeDependencies - The provider's `write.nativeDependencies`.
 * @param answers - What each call answered, or undefined for a call that rejected.
 * @returns The violations.
 */
export function linkModeViolations(
  nativeDependencies: boolean,
  answers: readonly (DependencyLinkResult | undefined)[],
): string[] {
  const violations: string[] = [];

  for (const answer of answers) {
    if (answer === undefined) {
      continue;
    }

    if (answer.mode !== "native" && answer.mode !== "fallback") {
      violations.push(`linkDependency answered mode ${String(answer.mode)}, which is neither mode`);
    } else if (answer.mode === "native" && !nativeDependencies) {
      violations.push(
        "linkDependency answered mode native, and the declaration says fallback — the UI tells a " +
          "person which mode ran",
      );
    }
  }

  return violations;
}

/**
 * Run a write and report a rejection as a sentence.
 *
 * @param at - What the call is, for the sentence.
 * @param run - The call.
 * @returns The value, or the violation that it rejected.
 */
async function attempt<T>(
  at: string,
  run: () => Promise<T>,
): Promise<{ value: T; violations: [] } | { value: undefined; violations: [string] }> {
  const settled = await settle(run);

  return settled.resolved
    ? { value: settled.value, violations: [] }
    : { value: undefined, violations: [`${at} rejected: ${describeThrown(settled.error)}`] };
}

/**
 * The provider, narrowed — or a thrown sentence, which fails the case with the reason.
 *
 * @param provider - The harness's provider.
 * @returns It, as a write-capable provider.
 * @throws {Error} When it does not declare writes: the write suites have nothing to check.
 */
function writer(provider: TicketSourceProvider): WriteCapableProvider {
  if (!supportsWrites(provider)) {
    throw new Error(
      "the write suites run only against a provider declaring write.createTicket — a read-only " +
        "provider's declaration is checked by the read kit",
    );
  }

  return provider;
}

/**
 * The write suites.
 *
 * @param name - What the provider is called, for the `describe` block.
 * @param build - Builds a harness, fresh for every case.
 */
export function describeTicketSourceWriteConformance(
  name: string,
  build: () => TicketSourceWriteConformance,
): void {
  describe(`${name} — TicketSourceProvider write conformance`, () => {
    it("declares a coherent write declaration that agrees with its five members", () => {
      const { provider } = build();

      expect([
        ...writeMemberViolations(provider),
        ...(supportsWrites(provider)
          ? []
          : ["write.createTicket must be true to take these suites"]),
      ]).toEqual([]);
    });

    it("creates a ticket a sync could adopt, and exactly one", async () => {
      const { provider, context, drafts, ledger } = build();
      const before = ledger();
      const created = await attempt("createTicket", () =>
        writer(provider).createTicket(context, drafts[0]),
      );
      const after = ledger();

      expect([
        ...created.violations,
        ...(created.value === undefined ? [] : writeRefViolations(created.value, "createTicket")),
        ...ledgerGrowthViolations(before, after, { tickets: 1 }, "createTicket"),
        ...(created.value !== undefined && !after.tickets.includes(created.value.externalId)
          ? ["createTicket answered an externalId the tracker does not hold"]
          : []),
      ]).toEqual([]);
    });

    it("dedupes by idempotency key — the same draft twice is one ticket and one reference", async () => {
      const { provider, context, drafts, ledger } = build();
      const before = ledger();
      const first = await attempt("first createTicket", () =>
        writer(provider).createTicket(context, drafts[0]),
      );
      const second = await attempt("second createTicket", () =>
        writer(provider).createTicket(context, drafts[0]),
      );
      const other = await attempt("createTicket with another key", () =>
        writer(provider).createTicket(context, drafts[1]),
      );
      const violations = [
        ...(drafts[0].idempotencyKey === drafts[1].idempotencyKey
          ? ["the harness's two drafts must carry different idempotency keys"]
          : []),
        ...first.violations,
        ...second.violations,
        ...other.violations,
        ...ledgerGrowthViolations(before, ledger(), { tickets: 2 }, "two keys, three calls"),
      ];

      if (JSON.stringify(first.value) !== JSON.stringify(second.value)) {
        violations.push("the same idempotency key answered two different references");
      }

      if (first.value !== undefined && first.value.externalId === other.value?.externalId) {
        violations.push("two different idempotency keys answered the same ticket");
      }

      expect(violations).toEqual([]);
    });

    it("links a dependency in the declared mode — native, or the documented fallback — once however often it is asked", async () => {
      const { provider, context, drafts, ledger } = build();
      const write = writer(provider);
      const blocker = await attempt("createTicket (blocker)", () =>
        write.createTicket(context, drafts[0]),
      );
      const blocked = await attempt("createTicket (blocked)", () =>
        write.createTicket(context, drafts[1]),
      );

      if (blocker.value === undefined || blocked.value === undefined) {
        expect([...blocker.violations, ...blocked.violations]).toEqual([]);

        return;
      }

      const pair = [blocker.value, blocked.value] as const;
      const before = ledger();
      const first = await attempt("linkDependency", () => write.linkDependency(context, ...pair));
      const second = await attempt("linkDependency again", () =>
        write.linkDependency(context, ...pair),
      );
      const after = ledger();
      const violations: string[] = [
        ...first.violations,
        ...second.violations,
        ...ledgerGrowthViolations(before, after, { dependencies: 1 }, "linkDependency twice"),
        ...linkModeViolations(write.capabilities().write.nativeDependencies, [
          first.value,
          second.value,
        ]),
      ];

      if (
        !after.dependencies.some(
          ([from, to]) => from === pair[0].externalId && to === pair[1].externalId,
        )
      ) {
        violations.push(
          `the tracker holds no ${pair[0].externalKey} → ${pair[1].externalKey} relation`,
        );
      }

      const itself = await settle(() => write.linkDependency(context, pair[0], pair[0]));

      violations.push(
        ...writeFailureViolations(
          itself,
          "validation",
          context.credentials,
          "a ticket linked to itself",
        ),
      );

      expect(violations).toEqual([]);
    });

    it("ensures one milestone however often it is asked — or answers null when it declares none", async () => {
      const { provider, context, drafts, milestoneName, ledger } = build();
      const write = writer(provider);
      const before = ledger();
      const first = await attempt("ensureMilestone", () =>
        write.ensureMilestone(context, milestoneName),
      );
      const second = await attempt("ensureMilestone again", () =>
        write.ensureMilestone(context, milestoneName),
      );
      const violations: string[] = [...first.violations, ...second.violations];

      if (!write.capabilities().write.milestones) {
        if (first.value !== null || second.value !== null) {
          violations.push("write.milestones is false, so ensureMilestone must answer null");
        }

        violations.push(...ledgerGrowthViolations(before, ledger(), {}, "ensureMilestone"));
        expect(violations).toEqual([]);

        return;
      }

      violations.push(
        ...ledgerGrowthViolations(before, ledger(), { milestones: 1 }, "ensureMilestone twice"),
      );

      if (first.value === null || first.value === undefined) {
        violations.push("write.milestones is true, so ensureMilestone must answer a milestone");
      } else {
        if (JSON.stringify(first.value) !== JSON.stringify(second.value)) {
          violations.push("ensureMilestone answered two different milestones for one name");
        }

        const milestone = first.value;
        const assigned = await attempt("createTicket with a milestone", () =>
          write.createTicket(context, { ...drafts[0], milestone }),
        );

        violations.push(...assigned.violations);
      }

      expect(violations).toEqual([]);
    });

    it("lists the milestone it ensured — or none when it declares no milestones — and names its push target", async () => {
      const { provider, context, milestoneName, ledger } = build();
      const write = writer(provider);
      const violations: string[] = [];
      const target = await settle(() => Promise.resolve(write.pushTargetName(context.config)));

      if (!target.resolved || target.value.trim() === "") {
        violations.push("pushTargetName must name the push target for a valid configuration");
      }

      if (write.capabilities().write.milestones) {
        await attempt("ensureMilestone", () => write.ensureMilestone(context, milestoneName));
      }

      const before = ledger();
      const listed = await attempt("listMilestones", () => write.listMilestones(context));

      violations.push(
        ...listed.violations,
        ...ledgerGrowthViolations(before, ledger(), {}, "listMilestones"),
      );

      const names = (listed.value ?? []).map((milestone) => milestone.name);

      if (write.capabilities().write.milestones && !names.includes(milestoneName)) {
        violations.push("listMilestones did not list the milestone ensureMilestone created");
      }

      if (!write.capabilities().write.milestones && names.length > 0) {
        violations.push("write.milestones is false, so listMilestones must answer none");
      }

      expect(violations).toEqual([]);
    });

    it("ensures one epic container and one membership however often it is asked — or answers null under epicMapping none", async () => {
      const { provider, context, drafts, epic, ledger } = build();
      const write = writer(provider);
      const { epicMapping } = write.capabilities().write;
      const ticket = await attempt("createTicket", () => write.createTicket(context, drafts[0]));

      if (ticket.value === undefined) {
        expect(ticket.violations).toEqual([]);

        return;
      }

      const member: TicketWriteRef = ticket.value;
      const before = ledger();
      const first = await attempt("ensureEpicContainer", () =>
        write.ensureEpicContainer(context, epic),
      );
      const second = await attempt("ensureEpicContainer again", () =>
        write.ensureEpicContainer(context, { ...epic, title: `${epic.title} (renamed)` }),
      );
      const violations: string[] = [...first.violations, ...second.violations];

      if (epicMapping === "none") {
        if (first.value !== null || second.value !== null) {
          violations.push("epicMapping is none, so ensureEpicContainer must answer null");
        }

        // Not a crash: the one call that cannot be made correctly under `none` is refused as a
        // classifiable validation failure, never as a TypeError.
        const stray: EpicMirrorRef = { mapping: "parent_issue", externalRef: "stray-ref" };
        const attached = await settle(() => write.attachToEpic(context, member, stray));

        violations.push(
          ...ledgerGrowthViolations(before, ledger(), {}, "epics under none"),
          ...writeFailureViolations(
            attached,
            "validation",
            context.credentials,
            "attachToEpic under epicMapping none",
          ),
        );
        expect(violations).toEqual([]);

        return;
      }

      const mirror = first.value;

      if (mirror === null || mirror === undefined) {
        violations.push(
          `epicMapping is ${epicMapping}, so ensureEpicContainer must answer a mirror`,
        );
        expect(violations).toEqual([]);

        return;
      }

      if (mirror.mapping !== epicMapping) {
        violations.push(
          `ensureEpicContainer answered a ${String(mirror.mapping)} mirror under ${epicMapping}`,
        );
      }

      if (typeof mirror.externalRef !== "string" || mirror.externalRef.trim() === "") {
        violations.push("a mirror's externalRef must be non-blank — epic_mirrors refuses ''");
      }

      if (JSON.stringify(mirror) !== JSON.stringify(second.value)) {
        violations.push(
          "ensureEpicContainer answered two containers for one epic — the epic id is the key, " +
            "not the title",
        );
      }

      const attached = await attempt("attachToEpic", () =>
        write.attachToEpic(context, member, mirror),
      );
      const again = await attempt("attachToEpic again", () =>
        write.attachToEpic(context, member, mirror),
      );
      const after = ledger();

      violations.push(
        ...attached.violations,
        ...again.violations,
        ...ledgerGrowthViolations(
          before,
          after,
          { containers: 1, memberships: 1 },
          "ensureEpicContainer and attachToEpic twice each",
        ),
      );

      if (
        !after.memberships.some(
          ([ref, id]) => ref === mirror.externalRef && id === member.externalId,
        )
      ) {
        violations.push(`the tracker holds no membership of ${member.externalKey} in the epic`);
      }

      expect(violations).toEqual([]);
    });

    for (const errorClass of TICKET_SOURCE_WRITE_ERROR_CLASSES) {
      it(`classifies its recorded ${errorClass} refusal of a write as ${errorClass}`, async () => {
        const { provider, context, drafts, milestoneName, epic, refuse } = build();
        const write = writer(provider);

        refuse[errorClass]();

        const created = await settle(() => write.createTicket(context, drafts[0]));
        const violations = writeFailureViolations(
          created,
          errorClass,
          context.credentials,
          "createTicket",
        );

        // The container members fail the same way whenever they would reach the tracker at all —
        // under a declaration that answers null they need not, and that is not a violation.
        if (write.capabilities().write.milestones) {
          violations.push(
            ...writeFailureViolations(
              await settle(() => write.ensureMilestone(context, milestoneName)),
              errorClass,
              context.credentials,
              "ensureMilestone",
            ),
          );
        }

        if (write.capabilities().write.epicMapping !== "none") {
          violations.push(
            ...writeFailureViolations(
              await settle(() => write.ensureEpicContainer(context, epic)),
              errorClass,
              context.credentials,
              "ensureEpicContainer",
            ),
          );
        }

        expect(violations).toEqual([]);
      });
    }

    it("rolls back — a refused write leaves nothing behind, and the retry creates exactly one", async () => {
      const { provider, context, drafts, milestoneName, epic, ledger, refuse, recover } = build();
      const write = writer(provider);
      const blocker = await attempt("createTicket (blocker)", () =>
        write.createTicket(context, drafts[0]),
      );
      const violations: string[] = [...blocker.violations];
      const before = ledger();

      refuse.upstream();

      const refused = await settle(() => write.createTicket(context, drafts[1]));
      const refusedMilestone = await settle(() => write.ensureMilestone(context, milestoneName));
      const refusedEpic = await settle(() => write.ensureEpicContainer(context, epic));

      violations.push(
        ...writeFailureViolations(refused, "upstream", context.credentials, "refused createTicket"),
        ...ledgerGrowthViolations(before, ledger(), {}, "while the tracker was refusing"),
      );

      for (const [label, settled] of [
        ["ensureMilestone", refusedMilestone],
        ["ensureEpicContainer", refusedEpic],
      ] as const) {
        // A null answer is a declaration without the feature; anything else must have failed.
        if (settled.resolved && settled.value !== null) {
          violations.push(`${label} answered while the tracker was refusing`);
        }
      }

      recover();

      const retried = await attempt("createTicket after recovery", () =>
        write.createTicket(context, drafts[1]),
      );

      violations.push(
        ...retried.violations,
        ...ledgerGrowthViolations(before, ledger(), { tickets: 1 }, "the retry after recovery"),
      );

      if (blocker.value !== undefined && retried.value !== undefined) {
        const pair = [blocker.value, retried.value] as const;
        const beforeLink = ledger();

        refuse.rate_limit();

        const refusedLink = await settle(() => write.linkDependency(context, ...pair));

        violations.push(
          ...writeFailureViolations(
            refusedLink,
            "rate_limit",
            context.credentials,
            "refused linkDependency",
          ),
          ...ledgerGrowthViolations(beforeLink, ledger(), {}, "a refused linkDependency"),
        );

        recover();

        const relinked = await attempt("linkDependency after recovery", () =>
          write.linkDependency(context, ...pair),
        );

        violations.push(
          ...relinked.violations,
          ...ledgerGrowthViolations(
            beforeLink,
            ledger(),
            { dependencies: 1 },
            "the link retried after recovery",
          ),
        );
      }

      expect(violations).toEqual([]);
    });

    it("holds no credential once its writes have returned", async () => {
      const { provider, context, drafts, milestoneName, epic } = build();
      const write = writer(provider);
      const created = await attempt("createTicket", () => write.createTicket(context, drafts[0]));

      await settle(() => write.ensureMilestone(context, milestoneName));
      await settle(() => write.ensureEpicContainer(context, epic));

      expect([
        ...created.violations,
        ...retentionViolations(provider, context.credentials),
      ]).toEqual([]);
    });
  });
}
