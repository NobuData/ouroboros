-- copilot-invariants.sql — mockup 20's copilot probes (#558, CC.4), run on their own.
--
-- The assertions are lib/copilot-invariants.sql. This file owns the session around them: the
-- helpers and a transaction it rolls back. `ci/db` runs it against the *seeded* database, where
-- R__dev_seed_workspace_copilot.sql's conversation, draft, dry run and suggestions are the rows the
-- probes read; tests/verify-copilot-invariants.sh plants a violation of each invariant, one at a
-- time, to prove this goes red naming it.
--
--   PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
--     -v ON_ERROR_STOP=1 -f ouroboros-db/tests/copilot-invariants.sql
--
-- Exits non-zero on the first violated assertion.

\set ON_ERROR_STOP on

\o /dev/null

begin;

\ir lib/assert.sql

\ir lib/copilot-invariants.sql

rollback;

\o
\echo 'copilot-invariants.sql: all assertions passed'
