-- R__dev_seed_workspace_copilot.sql — mockup 20's page state, over the shared universe, in a
-- development database and nowhere else (#558, CC.4).
--
-- [`docs/mockups/20-workflow-copilot.html`](../../docs/mockups/20-workflow-copilot.html): Ken asks
-- the copilot for a security-patch workflow, answers its two questions, caps spend at $5 a run and
-- dry-runs the draft on `#489`; the dry run finishes in 2m 41s for $0.31 with two suggestions.
-- This file writes that page, every row through the writer and the rules V107/V110/V111/V114 hold
-- it to:
--
--   * **`#489`, the canonical twin** of the intake mirror's *CAN arbitration-lost storm under full
--     telemetry load* (R__dev_seed_intake.sql) — title, labels, author and times copied from the
--     mirror, never invented, as R__dev_seed_workspace_triage_inbox.sql files its twins. A dry run
--     names a canonical ticket (V111), and the intake seed only writes the mirror.
--   * **The `security-patch` workflow**, unpublished, and its draft at **`v0.3`** built by three
--     `apply_draft_batch()` batches: v0.1 Ken's starting draft in the canvas (eight stages and the
--     second reviewer), v0.2 the copilot's `exploit-verify` stage, v0.3 the copilot's
--     `label:security` trigger — so the page reads `draft v0.3 (2 copilot edits applied)` and only
--     exploit-verify carries `added by copilot`. The stage list's nine rows are ten DSL nodes:
--     `review ×2` is two reviewer stages, `claude-fable-5` (`coder-max`) and `cursor/composer-2`
--     (`second-opinion`).
--   * **W7's unresolved references, seeded unresolved.** `analyze` loads `skill:advisory-db`, which
--     no skill row names, and `exploit-verify` routes by the task `exploit-verify`, which no task
--     kind names — so the validator warns on both, as the page must.
--   * **The conversation** — six messages, both chip questions answered (`label:security ✓`,
--     `Yes ✓`), tool traces with the applied operations, one bounced-then-corrected edge, the
--     `$5/run` spend guard as a *proposed* `set_guard` (DSL v1 has no guard construct; V110), and a
--     cost on every copilot reply.
--   * **The dry run on `#489`** — left `running`, with six of its seven rows, their exact `how`
--     and notes, the overlay diff (`drivers/can/arbitration.c +41 −9`) and a pinned sha. Its
--     replayed **build row is computed from the farm's history**, which
--     `dev_seed_workspace_metrics_analyzer` writes after this file — so
--     R__dev_seed_workspace_replay.sql (#561) adds that row, completes the run (2m 41s, $0.31, a
--     clean guard audit) and files the two suggestions a finished run takes.
--   * **The ten `review_replay_pairs`** (6 style disagreements) the 81% suggestion's basis
--     stands on — the historical data CF.5 (#574) will produce for real.
--
-- Every statement carries `${ouro_dev_seed}`, so it cannot run in production; every insert ends
-- `on conflict do nothing`, and every write a trigger would refuse a second time is guarded too
-- (a batch only at the draft_rev before it, messages only into an empty session, stages only into
-- a running dry run). The workspace, Ken and every parent are found by natural key.
--
-- It must sort after `dev_seed_intake` (the mirror), `dev_seed_routing` (the aliases) and
-- `dev_seed_workflows`; `dev_seed_workspace_copilot` does.
--
-- Ids: `5eed0088` the ticket twin, `5eed0089` the workflow, `5eed008a` the session and its
-- messages, `5eed008b` the dry run, its stages and its diff, `5eed008d` the replay pairs
-- (`5eed008c`, the suggestions, is R__dev_seed_workspace_replay.sql's).

-- ---------------------------------------------------------------------------
-- #489's canonical twin.
-- ---------------------------------------------------------------------------
insert into ouroboros.tickets
  (id, organization_id, source_id, external_id, external_key, external_url, title, body,
   state, labels, author, source_created_at, source_updated_at, synced_at, sizing_status, meta)
select '5eed0088-0000-4000-8000-000000000489'::uuid, org."id", src.id, '489', '#489',
       'https://github.com/' || (src.config ->> 'login') || '/helios-firmware/issues/489',
       mirror.title, mirror.body, 'open', mirror.labels, mirror.author_login,
       mirror.gh_created_at, mirror.gh_updated_at, now() - interval '40 seconds',
       mirror.sizing_status,
       jsonb_build_object('github', jsonb_build_object('owner', src.config ->> 'login',
                                                       'repo',  'helios-firmware'))
  from ouroboros.organization org
  join ouroboros.ticket_sources src on src.organization_id = org."id" and src.kind = 'github'
                                   and src.display_name = 'GitHub · acme-robotics'
  join ouroboros.github_orgs gh     on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo  on repo.org_id = gh.id and repo.name = 'helios-firmware'
  join ouroboros.github_issues mirror on mirror.github_repo_id = repo.id and mirror.number = 489
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The security-patch workflow — unpublished; its draft is the batches below.
-- ---------------------------------------------------------------------------
insert into ouroboros.workflows (id, organization_id, slug, name, status, created_at)
select '5eed0089-0000-4000-8000-000000000001'::uuid, org."id", 'security-patch', 'security-patch',
       'active', date_trunc('day', now() - interval '16 hours') + time '15:01'
  from ouroboros.organization org
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- The conversation about it. Active: the draft is not promoted yet.
insert into ouroboros.copilot_sessions (id, organization_id, workflow_id, status, model_provenance,
                                        draft_name, created_by, created_at)
select '5eed008a-0000-4000-8000-000000000001'::uuid, wf.organization_id, wf.id, 'active',
       '[{"seq": 2, "alias": "coder-max", "model_id": "claude-fable-5"},
         {"seq": 4, "alias": "coder-max", "model_id": "claude-fable-5"},
         {"seq": 6, "alias": "coder-max", "model_id": "claude-fable-5"}]',
       'security-patch', ken."id", date_trunc('day', now() - interval '16 hours') + time '15:02'
  from ouroboros.workflows wf
  join ouroboros."user" ken on ken."email" = 'ken@acme-robotics.dev'
 where wf.id = '5eed0089-0000-4000-8000-000000000001'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The draft, v0.1 → v0.3.
-- ---------------------------------------------------------------------------

-- v0.1 — Ken's starting draft in the canvas: trigger, analyze (skill:advisory-db — unresolved),
-- plan, implement (routed by task), build (pool-a), test (twister full), the two reviewers, and
-- open PR (never auto-merge: the run ends at human review).
select count(batch.draft_rev) as applied
  from ouroboros.workflows wf
  join ouroboros."user" ken on ken."email" = 'ken@acme-robotics.dev'
  cross join lateral ouroboros.apply_draft_batch(wf.organization_id, wf.id, 'canvas', ken."id", null, null, '[
    {"kind": "set_trigger", "params": {"trigger": {"event": "ticket_queued", "conditions": {}}}},
    {"kind": "add_stage", "params": {"node": {"id": "trigger", "type": "trigger", "title": "trigger",
      "position": {"x": 0, "y": 0}, "config": {}}}},
    {"kind": "add_stage", "params": {"node": {"id": "analyze", "type": "llm", "title": "analyze",
      "position": {"x": 0, "y": 120}, "config": {"mode": "skill", "skill": "advisory-db",
        "prompt_template": "Map the code paths {{issue.title}} touches, and read the advisory for its CVE when it has one.",
        "routing": {"pinned_model": {"alias": "coder-std"}},
        "limits": {"max_retries": 1, "token_budget": 200000},
        "permissions": {"push_fixup": false, "touch_ci": false}}}}},
    {"kind": "add_stage", "params": {"node": {"id": "plan", "type": "llm", "title": "plan",
      "position": {"x": 0, "y": 240}, "config": {"mode": "prompt",
        "prompt_template": "Plan the patch for {{issue.title}} in small, reviewable steps.",
        "routing": {"pinned_model": {"alias": "coder-max"}},
        "limits": {"max_retries": 1, "token_budget": 200000},
        "permissions": {"push_fixup": false, "touch_ci": false}}}}},
    {"kind": "add_stage", "params": {"node": {"id": "implement", "type": "llm", "title": "implement",
      "position": {"x": 0, "y": 360}, "config": {"mode": "prompt",
        "prompt_template": "Implement the plan; keep the diff to what the plan names.",
        "routing": {"inherit_task": "implement"},
        "limits": {"max_retries": 2, "token_budget": 400000},
        "permissions": {"push_fixup": true, "touch_ci": false}}}}},
    {"kind": "add_stage", "params": {"node": {"id": "build", "type": "infra", "title": "build",
      "position": {"x": 0, "y": 480}, "config": {"runner_pool": "pool-a"}}}},
    {"kind": "add_stage", "params": {"node": {"id": "test", "type": "infra", "title": "test",
      "description": "twister full", "position": {"x": 0, "y": 600},
      "config": {"runner_pool": "pool-a", "command": "west twister --all"}}}},
    {"kind": "add_stage", "params": {"node": {"id": "review-primary", "type": "llm", "title": "review",
      "position": {"x": -160, "y": 840}, "config": {"mode": "prompt",
        "prompt_template": "Review the patch against the advisory and the acceptance criteria.",
        "routing": {"pinned_model": {"alias": "coder-max"}},
        "limits": {"max_retries": 0, "token_budget": 150000},
        "permissions": {"push_fixup": false, "touch_ci": false}}}}},
    {"kind": "add_stage", "params": {"node": {"id": "review-second", "type": "llm", "title": "review",
      "position": {"x": 160, "y": 840}, "config": {"mode": "prompt",
        "prompt_template": "Give an independent second review of the patch.",
        "routing": {"pinned_model": {"alias": "second-opinion"}},
        "limits": {"max_retries": 0, "token_budget": 150000},
        "permissions": {"push_fixup": false, "touch_ci": false}}}}},
    {"kind": "add_stage", "params": {"node": {"id": "open-pr", "type": "term", "title": "open PR",
      "description": "never auto-merge", "position": {"x": 0, "y": 960},
      "config": {"action": "needs_review", "options": {}}}}},
    {"kind": "add_edge", "params": {"edge": {"from": "trigger", "to": "analyze", "kind": "default"}}},
    {"kind": "add_edge", "params": {"edge": {"from": "analyze", "to": "plan", "kind": "default"}}},
    {"kind": "add_edge", "params": {"edge": {"from": "plan", "to": "implement", "kind": "default"}}},
    {"kind": "add_edge", "params": {"edge": {"from": "implement", "to": "build", "kind": "default"}}},
    {"kind": "add_edge", "params": {"edge": {"from": "build", "to": "test", "kind": "default"}}},
    {"kind": "add_edge", "params": {"edge": {"from": "test", "to": "review-primary", "kind": "default"}}},
    {"kind": "add_edge", "params": {"edge": {"from": "test", "to": "review-second", "kind": "default"}}},
    {"kind": "add_edge", "params": {"edge": {"from": "review-primary", "to": "open-pr", "kind": "default"}}},
    {"kind": "add_edge", "params": {"edge": {"from": "review-second", "to": "open-pr", "kind": "default"}}}
  ]'::jsonb) batch
 where wf.id = '5eed0089-0000-4000-8000-000000000001'
   and wf.draft_rev = 0
   and ${ouro_dev_seed};

-- v0.2 — the copilot's exploit-verify (the conversation's first reply): re-runs the CVE's PoC
-- against the patched build. It routes by the task `exploit-verify`, a kind the catalog does not
-- have yet — W7's second unresolved reference.
select count(batch.draft_rev) as applied
  from ouroboros.workflows wf
  cross join lateral ouroboros.apply_draft_batch(wf.organization_id, wf.id, 'copilot', null,
    '5eed008a-0000-4000-8000-000000000001'::uuid, null, '[
    {"kind": "add_stage", "params": {"node": {"id": "exploit-verify", "type": "llm", "title": "exploit-verify",
      "description": "reruns CVE PoC · sandboxed", "position": {"x": 0, "y": 720},
      "config": {"mode": "prompt",
        "prompt_template": "Re-run the CVE proof-of-concept against the patched build in the sandbox and attach the result to PR verification.",
        "routing": {"inherit_task": "exploit-verify"},
        "limits": {"max_retries": 0, "token_budget": 100000},
        "permissions": {"push_fixup": false, "touch_ci": false}}}}},
    {"kind": "remove_edge", "params": {"from": "test", "to": "review-primary"}},
    {"kind": "remove_edge", "params": {"from": "test", "to": "review-second"}},
    {"kind": "add_edge", "params": {"edge": {"from": "test", "to": "exploit-verify", "kind": "default"}}},
    {"kind": "add_edge", "params": {"edge": {"from": "exploit-verify", "to": "review-primary", "kind": "default"}}},
    {"kind": "add_edge", "params": {"edge": {"from": "exploit-verify", "to": "review-second", "kind": "default"}}}
  ]'::jsonb) batch
 where wf.id = '5eed0089-0000-4000-8000-000000000001'
   and wf.draft_rev = 1
   and ${ouro_dev_seed};

-- v0.3 — the copilot's trigger, from the answered chip: `label:security`.
select count(batch.draft_rev) as applied
  from ouroboros.workflows wf
  cross join lateral ouroboros.apply_draft_batch(wf.organization_id, wf.id, 'copilot', null,
    '5eed008a-0000-4000-8000-000000000001'::uuid, null, '[
    {"kind": "set_trigger", "params": {"trigger": {"event": "ticket_queued", "conditions": {"labels": ["security"]}}}}
  ]'::jsonb) batch
 where wf.id = '5eed0089-0000-4000-8000-000000000001'
   and wf.draft_rev = 2
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The conversation — six messages, written only into an empty session (seq is allocated).
-- ---------------------------------------------------------------------------
insert into ouroboros.copilot_messages (id, organization_id, session_id, role, body, choices,
                                        tool_trace, tokens_in, tokens_out, cost_cents, created_at)
select m.id, s.organization_id, s.id, m.role, m.body,
       -- The chips were answered by Ken's 15:04 reply: stamp them with that instant.
       replace(m.choices::text, '"15:04"',
               to_json(to_char((date_trunc('day', now() - interval '16 hours') + time '15:04')
                                 at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))::text)::jsonb,
       m.tool_trace,
       m.tokens_in, m.tokens_out, m.cost_cents,
       date_trunc('day', now() - interval '16 hours') + m.at
  from ouroboros.copilot_sessions s
  cross join (values
    (1, '5eed008a-0000-4000-8000-000000000101'::uuid, 'user',
     'Create a workflow for security patches: always get a second model''s review, never auto-merge, and prove the CVE is actually fixed.',
     null::jsonb, '{"operations": [], "reads": [], "dry_run_proposals": []}'::jsonb,
     null::integer, null::integer, null::integer, time '15:02'),
    (2, '5eed008a-0000-4000-8000-000000000102'::uuid, 'copilot',
     'Drafted security-patch — 8 stages, shown on the right. For "prove it''s actually fixed" I added an exploit-verify stage: it re-runs the CVE''s proof-of-concept against the patched build and attaches the result to PR verification. Two questions:',
     '[{"prompt": "What triggers it?", "options": ["label:security", "CVE pattern in title"], "selected": "label:security", "answered_at": "15:04"},
       {"prompt": "May it read the GitHub Advisory DB?", "options": ["Yes", "No"], "selected": "Yes", "answered_at": "15:04"}]'::jsonb,
     '{"operations": [
        {"op": {"kind": "add_stage", "params": {"id": "exploit-verify"}}, "outcome": "applied"},
        {"op": {"kind": "remove_edge", "params": {"from": "test", "to": "review-primary"}}, "outcome": "applied"},
        {"op": {"kind": "remove_edge", "params": {"from": "test", "to": "review-second"}}, "outcome": "applied"},
        {"op": {"kind": "add_edge", "params": {"from": "test", "to": "exploit_verify"}}, "outcome": "bounced",
         "validator_message": "edge.to \"exploit_verify\" names no stage — did you mean \"exploit-verify\"?"},
        {"op": {"kind": "add_edge", "params": {"from": "test", "to": "exploit-verify"}}, "outcome": "applied"},
        {"op": {"kind": "add_edge", "params": {"from": "exploit-verify", "to": "review-primary"}}, "outcome": "applied"},
        {"op": {"kind": "add_edge", "params": {"from": "exploit-verify", "to": "review-second"}}, "outcome": "applied"}],
       "reads": [{"tool": "catalog"}, {"tool": "skills"}, {"tool": "draft"}],
       "dry_run_proposals": []}'::jsonb,
     18400, 2100, 12, time '15:02'),
    (3, '5eed008a-0000-4000-8000-000000000103'::uuid, 'user',
     'label security. yes. also cap spend at $5 a run.',
     null, '{"operations": [], "reads": [], "dry_run_proposals": []}', null, null, null, time '15:04'),
    (4, '5eed008a-0000-4000-8000-000000000104'::uuid, 'copilot',
     'Added a $5/run spend guard. The draft is ready — want a dry run? #489 is the closest open issue (CAN arbitration storm, no CVE — a useful edge case).',
     null,
     '{"operations": [
        {"op": {"kind": "set_trigger", "params": {"conditions": {"labels": ["security"]}}}, "outcome": "applied"},
        {"op": {"kind": "set_guard", "params": {"spend_cap_cents": 500, "per": "run"}}, "outcome": "proposed"}],
       "reads": [{"tool": "tickets", "query": "open, closest to security-patch"}],
       "dry_run_proposals": [{"ticket": "#489", "reason": "security workflow × no-CVE issue — exercises the skip path"}]}',
     9800, 600, 4, time '15:04'),
    (5, '5eed008a-0000-4000-8000-000000000105'::uuid, 'user', 'dry run #489',
     null, '{"operations": [], "reads": [], "dry_run_proposals": []}', null, null, null, time '15:05'),
    (6, '5eed008a-0000-4000-8000-000000000106'::uuid, 'copilot',
     'Dry run finished — 2m 41s, $0.31, zero side effects. Two improvement suggestions below the results →',
     null, '{"operations": [], "reads": [{"tool": "dry_run_results"}], "dry_run_proposals": []}',
     5200, 300, 2, time '15:08')
  ) as m (ord, id, role, body, choices, tool_trace, tokens_in, tokens_out, cost_cents, at)
 where s.id = '5eed008a-0000-4000-8000-000000000001'
   and s.last_seq = 0
   and ${ouro_dev_seed}
 order by m.ord
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The dry run on #489 — written running, with its rows and diff. The replayed build row and the
-- completion are R__dev_seed_workspace_replay.sql's (#561).
-- ---------------------------------------------------------------------------
insert into ouroboros.dry_runs (id, organization_id, workflow_id, base_version, draft_rev, session_id,
                                ticket_id, pinned_sha, mode, status, precheck_findings, started_at)
select '5eed008b-0000-4000-8000-000000000001'::uuid, wf.organization_id, wf.id, null, 3,
       '5eed008a-0000-4000-8000-000000000001'::uuid, t.id,
       '8c1b2e40d6a5f3c19b7e2a4d8f0c6b13e5a7d9f2', 'deep', 'running', '[]',
       date_trunc('day', now() - interval '16 hours') + time '15:05'
  from ouroboros.workflows wf
  join ouroboros.tickets t on t.organization_id = wf.organization_id
                          and t.id = '5eed0088-0000-4000-8000-000000000489'
 where wf.id = '5eed0089-0000-4000-8000-000000000001'
   and wf.draft_rev = 3
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.dry_run_stages (id, organization_id, dry_run_id, seq, stage_key, display_name,
                                      verdict, how, note, metrics, skip_reason)
select st.id, r.organization_id, r.id, st.seq, st.stage_key, st.display_name, st.verdict, st.how,
       st.note, st.metrics, st.skip_reason
  from ouroboros.dry_runs r
  cross join (values
    ('5eed008b-0000-4000-8000-000000000101'::uuid, 1, 'analyze', 'analyze', 'ok', 'llm',
     'mapped 4 files · advisory DB skipped (no CVE on this issue)',
     '{"tokens": 18200, "cost_cents": 6, "files_touched": 4}'::jsonb, null::text),
    ('5eed008b-0000-4000-8000-000000000102'::uuid, 2, 'plan', 'plan', 'ok', 'llm',
     '3 steps · would touch drivers/can/arbitration.c',
     '{"tokens": 12400, "cost_cents": 5}', null),
    ('5eed008b-0000-4000-8000-000000000103'::uuid, 3, 'implement', 'implement', 'ok', 'llm',
     'diff drafted +41 −9 (below) · 84k tokens',
     '{"tokens": 84000, "cost_cents": 14, "files_touched": 1, "simulated_writes": 1, "lines_added": 41, "lines_removed": 9}', null),
    ('5eed008b-0000-4000-8000-000000000105'::uuid, 5, 'exploit-verify', 'exploit-verify', 'skipped', 'skipped',
     'no PoC exists: stage had nothing to do', '{}', 'no PoC exists: stage had nothing to do'),
    ('5eed008b-0000-4000-8000-000000000106'::uuid, 6, 'review', 'review ×2', 'ok', 'llm',
     'both approve · 1 style nit', '{"tokens": 16600, "cost_cents": 6}', null),
    ('5eed008b-0000-4000-8000-000000000107'::uuid, 7, 'open-pr', 'open PR', 'not_reached', 'deterministic',
     'would open DRAFT PR · not merged (policy)', '{}', null)
  ) as st (id, seq, stage_key, display_name, verdict, how, note, metrics, skip_reason)
 where r.id = '5eed008b-0000-4000-8000-000000000001'
   and r.status = 'running'
   and ${ouro_dev_seed}
on conflict do nothing;

insert into ouroboros.dry_run_artifacts (id, organization_id, dry_run_id, kind, content, truncated,
                                         original_bytes, path_summary)
select '5eed008b-0000-4000-8000-000000000201'::uuid, r.organization_id, r.id, 'overlay_diff',
       diff.content, false, octet_length(diff.content),
       '[{"path": "drivers/can/arbitration.c", "added": 41, "removed": 9}]'
  from ouroboros.dry_runs r
  cross join (values (
'--- a/drivers/can/arbitration.c
+++ b/drivers/can/arbitration.c
@@ -212,8 +212,11 @@ static void can_handle_tx_error(const struct device *dev, struct can_frame *frame, uint32_t err)
-	if (err & CAN_ERR_LOSTARB) {
-		can_retry_tx(dev, frame); /* immediate retry floods the bus */
+	if (err & CAN_ERR_LOSTARB) {
+		k_sleep(K_USEC(backoff_us)); /* exponential backoff, 50–800 µs */
+		backoff_us = MIN(backoff_us << 1, CAN_ARB_BACKOFF_MAX_US);
+		can_retry_tx(dev, frame);
')) as diff (content)
 where r.id = '5eed008b-0000-4000-8000-000000000001'
   and r.status = 'running'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The reviewer-pair replays the 81% suggestion stands on — ten historical changes of
-- helios-firmware (the planning seed's closed #540–#549), six style disagreements.
-- ---------------------------------------------------------------------------
insert into ouroboros.review_replay_pairs (id, organization_id, workflow_id, replay_set, sample_ref,
                                           reviewer_stages, agreed, disagreement_class, replayed_at)
select ('5eed008d-0000-4000-8000-' || lpad(p.n::text, 12, '0'))::uuid, wf.organization_id, wf.id,
       '5eed008d-0000-4000-8000-000000000000'::uuid, '#' || (539 + p.n),
       array['review-primary', 'review-second'], p.agreed,
       case when p.agreed then null else 'style' end,
       date_trunc('day', now() - interval '16 hours') + time '15:06' + make_interval(secs => p.n * 6)
  from ouroboros.workflows wf
  cross join (values (1, false), (2, true), (3, false), (4, false), (5, true),
                     (6, false), (7, true), (8, false), (9, true), (10, false)) as p (n, agreed)
 where wf.id = '5eed0089-0000-4000-8000-000000000001'
   and ${ouro_dev_seed}
on conflict do nothing;
