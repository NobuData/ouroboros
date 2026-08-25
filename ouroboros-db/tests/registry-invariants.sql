-- registry-invariants.sql — the registry probes (#583, CG.5), run on their own.
--
-- The assertions are lib/registry-invariants.sql, and constraints.sql includes the same
-- file as its CG.5 section: this is the second way in, for the database that file cannot be
-- pointed at. `ci/db` migrates a *seeded* database for #582's fixtures, and constraints.sql
-- is not runnable against it — it carries plan assertions chosen from the catalogue's
-- statistics, and a database with the demo workspace in it plans differently from an empty
-- one. The registry probes have no such dependency: they create the rows they need and
-- assert nothing about a table's size, which is what lets them be asked of the seeded
-- database directly.
--
--   PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
--     -v ON_ERROR_STOP=1 -f ouroboros-db/tests/registry-invariants.sql
--
-- Everything happens inside the transaction rolled back at the foot, so a run against a
-- database somebody is using leaves it exactly as it was found — including the seed, which
-- `ci/db` re-asserts with tests/seed.sql afterwards to say so rather than to assume it.
--
-- Exits non-zero on the first violated assertion, like its two siblings.

\set ON_ERROR_STOP on

-- A passing assertion returns void, so the only thing a result row could print is a
-- screenful of empty one-row tables. Errors are unaffected: they go to stderr and
-- ON_ERROR_STOP still aborts.
\o /dev/null

begin;

-- must_hold and must_reject, in pg_temp so they disappear with the session. Shared with
-- constraints.sql and seed.sql — see lib/assert.sql.
\ir lib/assert.sql

\ir lib/registry-invariants.sql

rollback;

\o
\echo 'registry-invariants.sql: all assertions passed'
