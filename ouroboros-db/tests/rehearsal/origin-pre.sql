-- rehearsal/origin-pre.sql — the rows V141's back-fill (DJ.1, #1313) has to classify.
--
-- Applied to a seeded database migrated to V140 only; rehearsal/origin-post.sql asserts what
-- V141 made of them. Beside the seed's own rows (every id `5eed…` — seeded), it plants the
-- shapes a real deployment holds and the seed does not, with `bbbb…` ids so the post file can
-- tell them apart on sight:
--
--   * a run AP.1 opened for the engine — its `run.create` receipt — which must come out live;
--   * a run the simulator opened — R4's watermark — which must come out simulated;
--   * usage, a build and a pull request on each, which must inherit;
--   * a pull request a person opened and a build a person submitted, with no run — live.
--
-- origin-plant.sql is the other half: one run nothing classifies, which must stop V141.
insert into ouroboros.runs
select (jsonb_populate_record(null::ouroboros.runs, to_jsonb(run) || jsonb_build_object(
          'id', 'bbbb0000-0000-4000-8000-00000000000a', 'loop_seq', 913131, 'simulated', false))).*
  from ouroboros.runs run where run.id = '5eed0009-0000-4000-8000-000000000482';

insert into ouroboros.run_ingest_receipts
  (organization_id, run_id, operation, idempotency_key, request_digest, response)
select organization_id, 'bbbb0000-0000-4000-8000-00000000000a', 'run.create',
       'rehearsal-1313', repeat('0', 64), '{}'::jsonb
  from ouroboros.runs where id = 'bbbb0000-0000-4000-8000-00000000000a';

insert into ouroboros.runs
select (jsonb_populate_record(null::ouroboros.runs, to_jsonb(run) || jsonb_build_object(
          'id', 'bbbb0000-0000-4000-8000-00000000000b', 'loop_seq', 913132, 'simulated', true))).*
  from ouroboros.runs run where run.id = '5eed0009-0000-4000-8000-000000000482';

insert into ouroboros.token_usage (id, organization_id, run_id, provider, model, tokens_in, tokens_out)
select 'bbbb0000-0000-4000-8000-0000000000a1', organization_id, id, 'anthropic', 'claude', 1, 1
  from ouroboros.runs where id = 'bbbb0000-0000-4000-8000-00000000000a';
insert into ouroboros.token_usage (id, organization_id, run_id, provider, model, tokens_in, tokens_out)
select 'bbbb0000-0000-4000-8000-0000000000b1', organization_id, id, 'anthropic', 'claude', 1, 1
  from ouroboros.runs where id = 'bbbb0000-0000-4000-8000-00000000000b';

-- A build a person submitted, with no run: a copy of a seeded build, run-less.
insert into ouroboros.build_jobs
select (jsonb_populate_record(null::ouroboros.build_jobs, to_jsonb(job) || jsonb_build_object(
          'id', 'bbbb0000-0000-4000-8000-0000000000c1', 'run_id', null,
          'number', 913130, 'retry_of', null))).*
  from ouroboros.build_jobs job
 order by job.id
 limit 1;

-- A pull request a person opened, with no run.
insert into ouroboros.pull_requests
select (jsonb_populate_record(null::ouroboros.pull_requests, to_jsonb(pr) || jsonb_build_object(
          'id', 'bbbb0000-0000-4000-8000-0000000000d1', 'run_id', null,
          'external_number', 913130))).*
  from ouroboros.pull_requests pr
 order by pr.id
 limit 1;
