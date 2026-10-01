# sessions.sh — the two-session harness the ouroboros-db concurrency scripts share.
#
# Some rules only show themselves under a race, and a race needs two sessions: one that holds
# a transaction open and one that runs into it. constraints.sql is one psql session inside one
# transaction and cannot do that, so each concurrency script (verify-alias-reference-guard.sh,
# verify-analysis-run-guard.sh) drives two long-lived psql sessions through these helpers and
# asserts what each one is left holding. Extracted from verify-alias-reference-guard.sh by #506,
# unchanged.
#
# Dot-source it after scripts/lib/checks.sh (for pass/fail) with these already set:
#
#   runner          psql | docker — how a session reaches the server
#   POSTGRES_IMAGE  the client image, for runner=docker
#   DB_HOST DB_PORT DB_USER
#   GUARD_DB        the throwaway database the sessions and scalar() talk to
#   WORK            a scratch directory for the session pipes and transcripts
#   TIMEOUT_SECONDS how long a wait may take before it is called a failure
#
# The caller owns WORK and the database, and its cleanup should call `session_close a` and
# `session_close b` before dropping either.

# sql DBNAME — run the SQL on stdin against DBNAME as a one-shot session.
#
# Deliberately without ON_ERROR_STOP: the callers send statements that are *expected* to be
# refused, and what they assert is the refusal rather than the exit status.
sql() {
  case $runner in
    psql)
      psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$1" -X -q -A -t -f -
      ;;
    docker)
      docker run --rm -i --network=host --env PGPASSWORD "$POSTGRES_IMAGE" \
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$1" -X -q -A -t -f -
      ;;
  esac
}

maintenance() { printf '%s\n' "$1" | sql postgres >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# Two sessions that stay open.
#
# A psql reading from a named pipe is a session that lives until the pipe is closed, which
# is what lets a statement be sent, its effect observed, and the transaction left open
# while the other session is driven. Its transcript accumulates in a file, so waiting for a
# statement to finish is waiting for its marker to appear there — and a statement that is
# *blocked* is exactly one whose marker does not.
#
# Session A holds file descriptor 7 and session B holds 8. Fixed descriptors rather than a
# lookup because POSIX shell has no arrays and two is all this needs.
# ---------------------------------------------------------------------------

SESSION_A_PID=
SESSION_B_PID=

# session_open NAME — start a session reading from WORK/NAME.in, transcribing to WORK/NAME.out.
session_open() {
  rm -f "$WORK/$1.in"
  mkfifo "$WORK/$1.in"
  : > "$WORK/$1.out"

  # Started before the writing end is opened: opening a fifo for reading blocks until a
  # writer arrives and vice versa, so the two `exec`s below are what let each other through.
  #
  # The `exec 7>&- 8>&-` inside the subshell is load-bearing rather than tidy. A background
  # command inherits every descriptor the shell has open, so without it session B's psql
  # holds a *writing* end of session A's pipe — and A then never sees the EOF that closing
  # descriptor 7 is supposed to be, so session_close waits for a process that has no reason
  # to exit. It is `exec` inside a subshell rather than a `7>&-` redirection on the command,
  # because a redirection attached to a shell *function* is undone when the function
  # returns, and `sql` is one.
  ( exec 7>&- 8>&-; sql "$GUARD_DB" ) < "$WORK/$1.in" > "$WORK/$1.out" 2>&1 &

  case $1 in
    a) SESSION_A_PID=$!; exec 7> "$WORK/a.in" ;;
    b) SESSION_B_PID=$!; exec 8> "$WORK/b.in" ;;
  esac
}

# session_send NAME SQL — write one or more statements into a session.
session_send() {
  case $1 in
    a) printf '%s\n' "$2" >&7 ;;
    b) printf '%s\n' "$2" >&8 ;;
  esac
}

# session_close NAME — close the writing end, which is the session's EOF, and wait for the
# session to actually go.
#
# Waited on rather than left to exit on its own, because the next interleaving reuses the
# name: a psql still holding its transaction open would keep a lock on the very rows the
# next fixture reset is about to replace, and a transcript still being written would be
# truncated out from under it.
session_close() {
  case $1 in
    a) [ -n "$SESSION_A_PID" ] || return 0
       exec 7>&-; wait "$SESSION_A_PID" 2>/dev/null || true; SESSION_A_PID= ;;
    b) [ -n "$SESSION_B_PID" ] || return 0
       exec 8>&-; wait "$SESSION_B_PID" 2>/dev/null || true; SESSION_B_PID= ;;
  esac
}

# session_saw NAME PATTERN — whether a session's transcript matches an extended regex yet.
session_saw() { grep -Eq -- "$2" "$WORK/$1.out"; }

# await_output NAME PATTERN DESCRIPTION — wait for a statement to finish, then assert it did.
#
# Every statement below is followed by a `select 'marker'`, so its marker appearing is the
# statement having run to completion — and the marker *not* appearing within the timeout is
# the statement being blocked, which two of the three interleavings assert on purpose.
await_output() {
  await_left=$TIMEOUT_SECONDS
  while [ "$await_left" -gt 0 ]; do
    if session_saw "$1" "$2"; then
      pass "$3"
      return 0
    fi
    sleep 1
    await_left=$((await_left - 1))
  done
  fail "$3 (nothing matching \"$2\" in session $1 after ${TIMEOUT_SECONDS}s)"
}

# waiting_sessions — how many connections to this database are stuck behind a lock.
waiting_sessions() {
  printf "select count(*) from pg_stat_activity where datname = '%s' and wait_event_type = 'Lock';\n" \
    "$GUARD_DB" | sql "$GUARD_DB" | tr -d '[:space:]'
}

# await_block DESCRIPTION — wait until exactly one session is waiting on a lock.
#
# The positive half of the criterion, and it is asserted from PostgreSQL's own view rather
# than inferred from a marker that has not arrived: "the statement has not finished" and
# "the statement is waiting for a lock" are different claims, and only the second one says
# the guard did anything.
await_block() {
  block_left=$TIMEOUT_SECONDS
  while [ "$block_left" -gt 0 ]; do
    if [ "$(waiting_sessions)" = "1" ]; then
      pass "$1"
      return 0
    fi
    sleep 1
    block_left=$((block_left - 1))
  done
  fail "$1 (no session was waiting on a lock after ${TIMEOUT_SECONDS}s)"
}

# await_no_block DESCRIPTION — assert nothing is waiting on a lock right now.
await_no_block() {
  if [ "$(waiting_sessions)" = "0" ]; then
    pass "$1"
  else
    fail "$1 (a session is waiting on a lock)"
  fi
}

# scalar SQL — one value, read on a connection of its own.
scalar() { printf '%s\n' "$1" | sql "$GUARD_DB" | tr -d '[:space:]'; }
