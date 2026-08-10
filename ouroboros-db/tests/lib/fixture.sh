# fixture.sh — the synthetic module and stub runners the ouroboros-db tests share.
#
# Every script in this module ends up running Flyway against a database. No test here
# wants a database, a Flyway, or the developer's own .env, so each of them builds the
# same two things first: a copy of this module somewhere disposable, and `docker` /
# `flyway` executables that record how they were called instead of doing anything. Both
# live here so the two suites cannot drift into testing different fixtures.
#
# Dot-source it with MODULE_DIR (this module) and REPO_ROOT (the checkout around it)
# already set — both suites resolve those from their own location anyway — then:
#
#   fixture_stubs "$work"          # $work/{both,docker-only,neither} PATH directories
#   fixture_module "$work/base"    # a checkout with a working ouroboros-db inside it
#
# Every stub appends `<name> <arguments>` to $STUB_LOG and exits ${STUB_EXIT:-0}, which
# is what lets a test assert on the command that would really have run — and make it
# fail on demand.

# fixture_stubs WORKDIR — create the three PATH directories the runner tests need.
#
#   both         a local Flyway and a Docker, so preference can be observed
#   docker-only  only Docker, so the fallback can be
#   neither      neither, so the refusal can be
#
# The few real tools the scripts under test call are symlinked in, because these tests
# replace PATH wholesale rather than prepending to it: a stub that is merely first can
# still be shadowed, and this way nothing installed on the developer's machine can
# change the result.
fixture_stubs() {
  fixture_work=$1
  mkdir -p "$fixture_work/both" "$fixture_work/docker-only" "$fixture_work/neither"

  for fixture_tool in sh awk sed cut dirname tr; do
    fixture_resolved=$(command -v "$fixture_tool")
    ln -sf "$fixture_resolved" "$fixture_work/both/$fixture_tool"
    ln -sf "$fixture_resolved" "$fixture_work/docker-only/$fixture_tool"
    ln -sf "$fixture_resolved" "$fixture_work/neither/$fixture_tool"
  done

  for fixture_tool in docker flyway; do
    cat > "$fixture_work/both/$fixture_tool" <<STUB
#!/usr/bin/env sh
set -u
printf '$fixture_tool %s\n' "\$*" >> "\$STUB_LOG"
exit "\${STUB_EXIT:-0}"
STUB
    chmod +x "$fixture_work/both/$fixture_tool"
  done
  cp "$fixture_work/both/docker" "$fixture_work/docker-only/docker"
}

# fixture_module ROOT — a disposable checkout: ROOT/ouroboros-db holding this module's
# real scripts and configuration, and ROOT/scripts/lib holding the parser run.sh shares
# with the rest of the repository.
#
# The scripts are the committed ones, so what is tested is what ships; only their
# surroundings are synthetic. Anything a test writes — a .env, a misnamed migration —
# goes in here and never in the developer's working copy.
fixture_module() {
  fixture_root=$1
  mkdir -p "$fixture_root/ouroboros-db/migrations" "$fixture_root/scripts/lib"
  cp "$MODULE_DIR/run.sh" "$MODULE_DIR/flyway.toml" "$MODULE_DIR/flyway.dev.toml" \
    "$fixture_root/ouroboros-db/"
  cp -R "$MODULE_DIR/scripts" "$fixture_root/ouroboros-db/scripts"
  cp "$REPO_ROOT/scripts/lib/parse-env-example.awk" "$fixture_root/scripts/lib/"
  printf 'select 1;\n' > "$fixture_root/ouroboros-db/migrations/V000__bootstrap.sql"
}
