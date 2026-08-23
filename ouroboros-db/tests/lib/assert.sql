-- assert.sql — the assertion helpers the live-database suites share.
--
-- The SQL counterpart of scripts/lib/checks.sh: constraints.sql and seed.sql both need
-- the same handful, and one copy is what keeps a fix — or a failure message — the same in
-- both. Include it from a suite in this directory before the first assertion:
--
--   \ir lib/assert.sql
--
-- `\ir` resolves relative to the file that includes it, so a suite works whatever
-- directory psql was started in.
--
-- Every helper raises rather than returning a value, so `-v ON_ERROR_STOP=1` turns the
-- first violated assertion into a non-zero exit — which is what makes these files usable
-- as CI steps.
--
-- Extracted from constraints.sql by issue #23, unchanged.
--
-- In pg_temp so they disappear with the session and cannot be mistaken for schema.
-- Deliberately not plpgsql's `assert`, which is compiled out when plpgsql.check_asserts
-- is off — a check that can be silently disabled is not a check.
-- ---------------------------------------------------------------------------

-- Asserts a condition holds.
--   cond — the condition, already evaluated by the caller
--   what — description used in the failure message
create function pg_temp.must_hold(cond boolean, what text)
returns void language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FAILED: % (condition was %)', what, coalesce(cond::text, 'null');
  end if;
end;
$$;

-- Asserts a statement is refused by a constraint.
--
-- Only class 23 (integrity constraint violation) counts as a pass: a statement that
-- fails with a syntax error or an undefined column would otherwise look like a working
-- constraint. The inner block is a savepoint, so a rejected statement does not abort the
-- surrounding transaction.
--
--   stmt     — SQL to execute, expected to be rejected
--   what     — description used in the failure message
--   expected — constraint name that must be the one to fire. Optional, and worth naming
--              wherever the assertion is the point of the migration rather than
--              incidental: without it a statement rejected by some *other* rule — a
--              not-null, a check on an unrelated column — reads as a pass, and the rule
--              actually under test could be missing entirely.
create function pg_temp.must_reject(stmt text, what text, expected text default null)
returns void language plpgsql as $$
declare
  fired text;
begin
  begin
    execute stmt;
  exception
    when integrity_constraint_violation then
      get stacked diagnostics fired = constraint_name;
      if expected is not null and fired is distinct from expected then
        raise exception 'FAILED: % (rejected by % rather than %)', what, coalesce(fired, '<unnamed>'), expected;
      end if;
      return;
  end;
  raise exception 'FAILED: % (statement was accepted)', what;
end;
$$;

-- Asserts a statement is refused by a named SQLSTATE.
--
-- The sibling of must_reject, for the rules a *function* enforces on its arguments rather
-- than a constraint on a row: a catalog import told to apply an unversioned snapshot, or a
-- payload that is not an array, raises class 22 (data exception), which must_reject
-- deliberately does not accept. This is not a relaxation of that rule — the expected state
-- is required rather than optional, so a statement that failed some other way still fails
-- the assertion, and the reason must_reject exists is preserved.
--
--   stmt     — SQL to execute, expected to raise
--   state    — the SQLSTATE that must be the one raised
--   what     — description used in the failure message
create function pg_temp.must_raise(stmt text, state text, what text)
returns void language plpgsql as $$
declare
  raised text;
begin
  begin
    execute stmt;
  exception
    when others then
      get stacked diagnostics raised = returned_sqlstate;
      if raised is distinct from state then
        raise exception 'FAILED: % (raised % rather than %)', what, raised, state;
      end if;
      return;
  end;
  raise exception 'FAILED: % (statement was accepted)', what;
end;
$$;

-- Asserts a query's plan uses a named index.
--
-- Sequential scans are turned off by the caller for these checks: the fixture tables
-- hold a handful of rows, where a seq scan is genuinely cheaper and the planner is right
-- to prefer it. What is being asserted is that a usable index *exists* — that the
-- lookup is not condemned to a scan once the table is production-sized.
--
--   query — the SQL whose plan is inspected
--   idx   — index name expected to appear in the plan
create function pg_temp.must_use_index(query text, idx text)
returns void language plpgsql as $$
declare
  line text;
begin
  for line in execute 'explain ' || query loop
    if line like '%' || idx || '%' then
      return;
    end if;
  end loop;
  raise exception 'FAILED: % did not use index %', query, idx;
end;
$$;

-- Asserts a query's plan reaches every table it names through an index.
--
-- The sibling of must_use_index, for a plan with more than one relation in it. Naming one
-- index proves that *one* table was entered through it and says nothing about the others,
-- so a join whose second table is scanned passes must_use_index and is exactly the thing
-- an "is this one indexed query" criterion is asking about.
--
-- Read it together with the caller's `set local enable_seqscan = off`, which is what makes
-- the absence meaningful: with sequential scans discouraged, PostgreSQL still emits one
-- when there is no alternative — so a Seq Scan surviving in the plan means that relation
-- has no usable index, which is the state this asserts against. On a fixture of a handful
-- of rows it is the *existence* of the index that is being checked, not the plan a
-- production-sized table would get.
--
--   query — the SQL whose plan is inspected
create function pg_temp.must_not_scan(query text)
returns void language plpgsql as $$
declare
  line text;
begin
  for line in execute 'explain ' || query loop
    if line like '%Seq Scan%' then
      raise exception 'FAILED: % has no usable index — plan contains "%"', query, btrim(line);
    end if;
  end loop;
end;
$$;
