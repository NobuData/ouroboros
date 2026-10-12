-- chat-invariants.sql — mockup 19's Chat Ops probes (#534, BY.4), run on their own.
--
-- The assertions are lib/chat-invariants.sql. This file owns the session around them: the
-- helpers and a transaction it rolls back. `ci/db` runs it against the *seeded* database, where
-- R__dev_seed_workspace_triage_slack.sql's connection, channels, stream, routes, links and on-call
-- designee are the rows the probes read; tests/verify-chat-invariants.sh plants a violation of
-- each invariant, one at a time, to prove this goes red naming it.
--
--   PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
--     -v ON_ERROR_STOP=1 -f ouroboros-db/tests/chat-invariants.sql
--
-- Exits non-zero on the first violated assertion.

\set ON_ERROR_STOP on

\o /dev/null

begin;

\ir lib/assert.sql

\ir lib/chat-invariants.sql

rollback;

\o
\echo 'chat-invariants.sql: all assertions passed'
