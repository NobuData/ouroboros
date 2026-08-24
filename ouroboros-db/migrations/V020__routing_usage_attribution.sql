-- V020__routing_usage_attribution.sql — the two facts a spend event has to carry before
-- mockup 06's `$/run avg` and `p50 latency` columns can be *computed* rather than stored.
--
-- V010 (#66) made `token_usage` the append-only ledger of what the loop spent: who was
-- paid, which model, how many tokens, how much it cost, when. Every number mockup 02
-- renders is an aggregate over it, and the honesty rule that made it worth building —
-- **a figure the product cannot compute is a figure it does not print** — is what this
-- migration extends to routing.
--
-- Decision **M7** states the rule for mockup 06:
--
--   > `$/run`, p50 and spend are computed from `token_usage` + runs; no data → em-dash,
--   > never a fabricated number.
--
-- Three of that sentence's four figures were already computable. *Spend by provider · 30d*
-- is `sum(cost_cents)` grouped by `provider`; the local share is `tokens_in + tokens_out`
-- over the two local kinds; the em-dash falls out of a workspace with no rows. The two that
-- were **not** are the matrix's own columns, and the reason is the same for both: a spend
-- event knew which *model* it paid for and never which *kind of work* it was doing, and it
-- recorded how much a call cost without recording how long it took.
--
-- So a per-kind average had nowhere to group by, and a per-kind median had nothing to take
-- the median *of*. Two nullable columns close both, and this is deliberately the smallest
-- change that does:
--
--   | Column       | Answers                                    | Renders                |
--   |--------------|--------------------------------------------|------------------------|
--   | `task_kind`  | which routed kind of work this call served  | the matrix row it sits on |
--   | `latency_ms` | how long the call took                     | `p50 latency`          |
--
-- Filed as issue #192 (Y.4), which needed them to seed a database that renders mockup 06.
-- Read by Z.5 (#198), the stats service that folds both into the `GET /routing` payload.
--
-- ---------------------------------------------------------------------------
-- Why not on `runs`, which already has a workflow and a clock.
-- ---------------------------------------------------------------------------
--
-- Because a `runs` row is a **loop** — one issue, from *Implementing* to *Merged*, over
-- minutes or hours — and a task kind is a *step inside one*. The same run analyses, plans,
-- implements, generates tests and writes its own commit message; it has one
-- `workflow_tag`, one `started_at` and one `finished_at`, and no amount of arithmetic over
-- those recovers *"the median `implement` call took 41.0s"*. Putting a task kind on `runs`
-- would have forced one run per model call, which is not what the dashboard's *Loops live*
-- counts, and mockup 02's stat row is computed from exactly that count.
--
-- `token_usage` is already one row **per call**, which is the grain both figures are about.
-- The columns therefore land where the grain already is, and the dashboard read-model is
-- untouched: no view changes, no aggregate moves, and every figure V008–V011 support is
-- computed from the same rows it was yesterday.
--
-- ---------------------------------------------------------------------------
-- `task_kind` is text and has no foreign key, on V008's precedent.
-- ---------------------------------------------------------------------------
--
-- `task_kinds` (V016) has `unique (organization_id, name)`, so a composite foreign key
-- *would* have declared. It is deliberately not taken, and decision **F8** is why: V008
-- made `runs.workflow_tag` plain text with no reference so that *"a closed run must still
-- render under a renamed workflow"*. A ledger row is a record of something that happened.
-- Retiring a task kind must not be blocked by history (`restrict`), must not silently
-- delete it (`cascade`), and cannot null it (`organization_id` is the other half of any
-- composite key here and is `not null`) — and every one of those is a worse answer than
-- letting the ledger keep the name the call was actually routed under.
--
-- What is enforced is the **shape**: the same `^[a-z0-9]+(-[a-z0-9]+)*$` and 64 characters
-- `task_kinds.name` itself carries, so a value this column holds is always a name that
-- table could hold. A kind the workspace never had therefore aggregates to its own row and
-- is visible, rather than being refused at write time — which is the correct trade for a
-- ledger the loop appends to while a route is being edited underneath it.
--
-- ---------------------------------------------------------------------------
-- Both columns are nullable, and null is what makes the em-dash real.
-- ---------------------------------------------------------------------------
--
-- Null `task_kind` is *this call was not routed work* — the seeded provider-level spend of
-- #68 and #221, an import, a chat completion, anything the router did not place. Null
-- `latency_ms` is *nobody timed it*. Neither is a zero, and that distinction is the whole
-- point: `avg(cost_cents)` over a kind with no rows is null and renders `—`, and
-- `percentile_cont` over no latencies is null and renders `—`. A default of `0` would have
-- rendered `$0.00` and `0.0s`, which are both excellent figures for work nobody has done —
-- the same failure V015's decision M8 refuses for `health` and DASH-J.4 refuses for an
-- unpriced call.
--
-- Z.5's acceptance criterion — *"p50 absent where timings don't exist"* — is therefore a
-- property of these two columns rather than a branch in a service.
--
-- ---------------------------------------------------------------------------
-- No new index, and that is a decision rather than an omission.
-- ---------------------------------------------------------------------------
--
-- The stats read is
--
--   select task_kind, avg(cost_cents),
--          percentile_cont(0.5) within group (order by latency_ms)
--     from ouroboros.token_usage
--    where organization_id = $1 and occurred_at >= $2 and task_kind is not null
--    group by task_kind
--
-- and `token_usage_organization_occurred_at_idx` (V010) already answers the whole of its
-- `where` — *this workspace, this window* — which is the selective part. What is left is a
-- grouping over rows already narrowed to one workspace's thirty days; an index on
-- `task_kind` would order that set without reducing it. The index to add is the one a
-- profile asks for, and this migration has no profile to point at.
--
-- ---------------------------------------------------------------------------
-- token_usage — which kind of work, and how long it took.
-- ---------------------------------------------------------------------------
alter table ouroboros.token_usage
  -- The routed task kind this call served — `implement`, `commit-msg`. Text and no
  -- reference, on decision F8's precedent; see the header. Null for spend the router did
  -- not place, which is the ordinary state for every row written before this column
  -- existed.
  add column task_kind text,

  -- How long the call took, in whole milliseconds. Null where nothing timed it — never 0,
  -- which is a very fast call rather than an unmeasured one.
  --
  -- Milliseconds rather than an interval because it is a *duration of one call* and is
  -- rendered as `41.0s` and `0.8s`; an interval invites a unit per writer and makes the
  -- median a cast away from being a number.
  add column latency_ms integer;

alter table ouroboros.token_usage
  -- The shape `task_kinds.name` carries (V016), so this column can only hold names that
  -- table could hold. Blank and untrimmed are refused by the pattern itself.
  add constraint token_usage_task_kind_shape
    check (task_kind is null
           or (task_kind ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(task_kind) <= 64)),

  -- A duration is not negative. Zero is allowed and means *measured, and it took under a
  -- millisecond* — which a local daemon on loopback genuinely can; what says *unmeasured*
  -- is the null, and the two must stay tellable apart.
  add constraint token_usage_latency_ms_nonnegative
    check (latency_ms is null or latency_ms >= 0);

comment on column ouroboros.token_usage.task_kind is
  'Which routed kind of work this call served — task_kinds.name as the router placed it (#192, decision M7). Plain text and deliberately no foreign key, on V008''s decision F8 precedent: a ledger row records what happened, and retiring or renaming a task kind must not block, delete or rewrite the history routed under it. Null is not routed work — provider-level spend, an import, a completion the router did not place — and is what makes the matrix''s per-kind $/run avg an honest em-dash instead of $0.00.';
comment on column ouroboros.token_usage.latency_ms is
  'How long this call took, in whole milliseconds — the only source mockup 06''s p50 latency column has (#192, decision M7). Null means nobody timed it, and percentile_cont over no latencies is null, which renders the em-dash Z.5 (#198) requires "where timings don''t exist". Never defaulted to 0: 0 is a call that returned inside a millisecond, which is a measurement, not the absence of one.';

comment on constraint token_usage_task_kind_shape on ouroboros.token_usage is
  'A task kind here is shaped as task_kinds.name is (#192) — lower-case, hyphen-separated, at most 64 characters. The shape rather than a reference, because the reference is the thing decision F8 refuses; what this guarantees is that every value could name a kind, so a typo aggregates to a visible row of its own rather than to a name no table could ever hold.';
comment on constraint token_usage_latency_ms_nonnegative on ouroboros.token_usage is
  'A duration is not negative (#192). Zero is permitted deliberately — a local daemon on loopback answers in under a millisecond — because the value that means unmeasured is null, and a schema that conflated the two would make the em-dash unreachable.';

comment on table ouroboros.token_usage is
  'Append-only token spend ledger (#66) — one row per call, not one row per organization. The read-model behind mockup 02''s Token spend · today stat, read through token_usage_daily, and the source of the per-run cost attribution mockup 15 is made of. Decision F10: totals are aggregates over events, because a stored total drifts the moment anything is corrected. Since V020 (#192, decision M7) it is also what mockup 06''s routing matrix is computed from: task_kind says which routed kind of work a call served and latency_ms how long it took, so $/run avg and p50 latency are aggregates here rather than numbers stored on a route.';
