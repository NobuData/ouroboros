-- R__dev_seed_workspace_replay.sql — the seeded dry run's replayed build row, computed from the
-- farm's seeded history, and what could only be written once that row was in: the run's
-- completion and its two suggestions. A development database and nowhere else (#561, CD.3;
-- the dry run itself is #558's, R__dev_seed_workspace_copilot.sql).
--
-- [`docs/mockups/20-workflow-copilot.html`](../../docs/mockups/20-workflow-copilot.html) draws the
-- build row as `✓ build (replayed from history) est. 4m 02s (214 similar builds, ±20s)`. That
-- figure is the mockup's; it was typed. This file writes the row the way a real dry run would
-- have: **V121's own functions over the builds this farm ran** — the similarity class of the
-- draft's `build` stage (pool-a, helios-firmware, the pool's executor, image and default command),
-- `build_replay_sample()` over the policy's window ending when the dry run started, and
-- `replay_estimate_note()` for the words. So the seeded row and the estimator in `ouroboros-rest`
-- cannot disagree, and no figure in the row is a literal. With the seeded history it reads a
-- median near 3m 40s over a little more than 200 builds — the mockup's figure class, not its digits.
-- Were the history ever below the floor, the row would say *insufficient history* instead: the
-- same rule the estimator applies.
--
-- **Why a file of its own.** A stage row can only be written while its dry run is open (V111),
-- and the history the row is computed from is written by `dev_seed_workspace_metrics_analyzer`,
-- which sorts *after* `dev_seed_workspace_copilot`. So the copilot seed leaves its dry run
-- `running` with six of its seven rows, and this file — which must sort after
-- `dev_seed_workspace_metrics_analyzer`, and `dev_seed_workspace_replay` does — adds the build
-- row, completes the run, and files the two suggestions (V114 takes them on a finished run).
--
-- Every statement carries `${ouro_dev_seed}`; every insert ends `on conflict do nothing`, and the
-- writes a trigger would refuse a second time are guarded by the run's status. Parents are found
-- by natural key, except the dry run and its workflow, whose ids are the copilot seed's own
-- (`5eed008b`, `5eed0089`); the suggestions keep `5eed008c`.

-- ---------------------------------------------------------------------------
-- The build row — the draft's `build` stage, replayed from history.
-- ---------------------------------------------------------------------------
insert into ouroboros.dry_run_stages (id, organization_id, dry_run_id, seq, stage_key, display_name,
                                      verdict, how, note, metrics, skip_reason)
select '5eed008b-0000-4000-8000-000000000104'::uuid, r.organization_id, r.id, 4, 'build', 'build',
       'ok', 'replayed',
       ouroboros.replay_estimate_note(
         'build',
         case when s.sample_count >= policy.sample_floor then s.median_ms end,
         s.sample_count,
         case when s.sample_count >= policy.sample_floor then s.spread_ms end),
       jsonb_build_object(
         'sample_count', s.sample_count,
         'similarity_class', ouroboros.build_similarity_class(pool.name, repo.name, pool.executor,
                                                              pool.image, pool.default_command),
         'window_days', policy.window_days)
       || case when s.sample_count >= policy.sample_floor
               then jsonb_build_object('estimate_ms', s.median_ms, 'spread_ms', s.spread_ms)
               else jsonb_build_object('insufficient_history', true) end,
       null
  from ouroboros.dry_runs r
  join ouroboros.github_orgs gh    on gh.organization_id = r.organization_id and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = 'helios-firmware'
  join ouroboros.runner_pools pool on pool.organization_id = r.organization_id and pool.name = 'pool-a'
  cross join ouroboros.replay_estimate_policy() policy
  cross join lateral ouroboros.build_replay_sample(r.organization_id, repo.id, pool.id, pool.executor,
                                                   pool.image, pool.default_command, r.started_at,
                                                   policy.window_days) s
 where r.id = '5eed008b-0000-4000-8000-000000000001'
   and r.status = 'running'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The run completes — 2m 41s, $0.31, guards clean.
-- ---------------------------------------------------------------------------
update ouroboros.dry_runs r
   set status = 'complete',
       duration_ms = 161000,
       cost_cents = 31,
       tokens = 131200,
       guard_audit = '[]',
       finished_at = r.started_at + interval '161 seconds'
 where r.id = '5eed008b-0000-4000-8000-000000000001'
   and r.status = 'running'
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The two suggestions — both rule-derived, with typed operations and a confidence basis.
-- ---------------------------------------------------------------------------

-- 93%: deterministic-skip. exploit-verify skipped with nothing to do on a security-labelled issue
-- with no CVE; the operations put a `has-cve` decision ahead of it so such issues route around it.
insert into ouroboros.dry_run_suggestions (id, organization_id, dry_run_id, source, rule_id, rule_version,
                                           title, body, evidence, proposed_ops, confidence,
                                           confidence_basis, created_at)
select '5eed008c-0000-4000-8000-000000000001'::uuid, r.organization_id, r.id, 'rule',
       'deterministic-skip', 1,
       'Make exploit-verify conditional',
       'Make exploit-verify conditional — it stalled with nothing to do because #489 has no CVE. Add when: issue.cve != null so security-labeled issues without a PoC skip it cleanly.',
       '{"stage_key": "exploit-verify", "verdict": "skipped",
         "skip_reason": "no PoC exists: stage had nothing to do",
         "ticket": "#489", "ticket_labels": ["bug", "can-bus"], "trigger_labels": ["security"]}',
       '[{"kind": "add_stage", "params": {"node": {"id": "has-cve", "type": "flow", "title": "has CVE?",
          "position": {"x": 0, "y": 660},
          "config": {"kind": "decision", "predicate": {"kind": "labels", "op": "any", "values": ["cve"]}}}}},
         {"kind": "remove_edge", "params": {"from": "test", "to": "exploit-verify"}},
         {"kind": "add_edge", "params": {"edge": {"from": "test", "to": "has-cve", "kind": "default"}}},
         {"kind": "add_edge", "params": {"edge": {"from": "has-cve", "to": "exploit-verify", "kind": "branch",
          "label": "cve", "condition": {"kind": "labels", "op": "any", "values": ["cve"]}}}},
         {"kind": "add_edge", "params": {"edge": {"from": "has-cve", "to": "review-primary", "kind": "branch",
          "label": "no cve", "condition": {"kind": "labels", "op": "none", "values": ["cve"]}}}},
         {"kind": "add_edge", "params": {"edge": {"from": "has-cve", "to": "review-second", "kind": "branch",
          "label": "no cve", "condition": {"kind": "labels", "op": "none", "values": ["cve"]}}}}]',
       93,
       '{"method": "rule_strength",
         "inputs": {"rule": "deterministic-skip", "outcome": "skipped_nothing_to_do", "deterministic": true,
                    "observations": 1, "base": 95, "single_observation_penalty": 2}}',
       date_trunc('day', now() - interval '16 hours') + time '15:08'
  from ouroboros.dry_runs r
 where r.id = '5eed008b-0000-4000-8000-000000000001'
   and r.status = 'complete'
   and ${ouro_dev_seed}
on conflict do nothing;

-- 81%: replay-disagreement. 6 of the 10 replayed pairs disagreed on style; the operations load the
-- pr-etiquette skill (R__dev_seed_workspace_knowledge.sql) into both reviewer stages.
insert into ouroboros.dry_run_suggestions (id, organization_id, dry_run_id, source, rule_id, rule_version,
                                           title, body, evidence, proposed_ops, confidence,
                                           confidence_basis, created_at)
select '5eed008c-0000-4000-8000-000000000002'::uuid, r.organization_id, r.id, 'rule',
       'replay-disagreement', 1,
       'Pin the pr-etiquette skill to both reviewers',
       'Pin the pr-etiquette skill to both reviewers — in 10 replayed review pairs, the two models disagreed on style nits 6 times; the shared skill removes the noise.',
       jsonb_build_object('stage_keys', jsonb_build_array('review-primary', 'review-second'),
                          'replay_set', '5eed008d-0000-4000-8000-000000000000',
                          'pairs_replayed', 10, 'style_disagreements', 6,
                          'substance_disagreements', 0, 'skill', 'pr-etiquette'),
       (select jsonb_agg(jsonb_build_object('kind', 'set_stage', 'params', jsonb_build_object('node',
                 jsonb_set(jsonb_set(n, '{config,mode}', '"skill"'), '{config,skill}', '"pr-etiquette"')))
               order by n ->> 'id')
          from jsonb_array_elements(v.definition -> 'nodes') n
         where n ->> 'id' in ('review-primary', 'review-second')),
       81,
       '{"method": "replay_statistics",
         "inputs": {"replay_set": "5eed008d-0000-4000-8000-000000000000", "pairs": 10,
                    "style_disagreements": 6, "substance_disagreements": 0,
                    "disagreement_rate": 0.6, "sample_penalty": 9}}',
       date_trunc('day', now() - interval '16 hours') + time '15:08'
  from ouroboros.dry_runs r
  join ouroboros.workflow_versions v on v.workflow_id = r.workflow_id and v.version is null
 where r.id = '5eed008b-0000-4000-8000-000000000001'
   and r.status = 'complete'
   and exists (select 1 from ouroboros.review_replay_pairs p
                where p.replay_set = '5eed008d-0000-4000-8000-000000000000')
   and ${ouro_dev_seed}
on conflict do nothing;
