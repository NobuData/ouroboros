-- rehearsal/origin-post.sql — what V141 (DJ.1, #1313) made of origin-pre.sql's rows.
\set ON_ERROR_STOP on

do $$
declare
  wrong bigint;
begin
  -- Every seeded row is seeded, on every table that carries an origin.
  select (select count(*) from ouroboros.runs where id::text like '5eed%' and origin <> 'seeded')
       + (select count(*) from ouroboros.token_usage where id::text like '5eed%' and origin <> 'seeded')
       + (select count(*) from ouroboros.build_jobs where id::text like '5eed%' and origin <> 'seeded')
       + (select count(*) from ouroboros.pull_requests where id::text like '5eed%' and origin <> 'seeded')
       + (select count(*) from ouroboros.test_runs t join ouroboros.runs r on r.id = t.run_id
           where r.id::text like '5eed%' and t.origin <> 'seeded')
    into wrong;
  if wrong <> 0 then raise exception 'FAILED: % seeded row(s) not seeded', wrong; end if;

  if (select origin from ouroboros.runs where id = 'bbbb0000-0000-4000-8000-00000000000a') <> 'live' then
    raise exception 'FAILED: a run with its run.create receipt is live';
  end if;
  if (select origin from ouroboros.runs where id = 'bbbb0000-0000-4000-8000-00000000000b') <> 'simulated' then
    raise exception 'FAILED: a watermarked run is simulated';
  end if;
  if (select origin from ouroboros.token_usage where id = 'bbbb0000-0000-4000-8000-0000000000a1') <> 'live'
     or (select origin from ouroboros.token_usage where id = 'bbbb0000-0000-4000-8000-0000000000b1') <> 'simulated' then
    raise exception 'FAILED: usage inherits its run''s origin';
  end if;
  if (select origin from ouroboros.build_jobs where id = 'bbbb0000-0000-4000-8000-0000000000c1') <> 'live'
     or (select origin from ouroboros.pull_requests where id = 'bbbb0000-0000-4000-8000-0000000000d1') <> 'live' then
    raise exception 'FAILED: a build or pull request a person made, with no run, is live';
  end if;

  -- The seeded run the run-console seed watermarks stays seeded — the seed convention first.
  if exists (select 1 from ouroboros.runs where id::text like '5eed%' and simulated and origin <> 'seeded') then
    raise exception 'FAILED: a seeded, watermarked run is seeded';
  end if;
end;
$$;

\echo 'origin-post.sql: the back-fill classified every row'
