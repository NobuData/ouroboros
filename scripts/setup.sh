#!/usr/bin/env sh
#
# setup.sh — create the .env files a first-time checkout needs.
#
# Renders every module's committed `.env.example` into the `.env` beside it, generating a
# real secret for each placeholder on the way past. It is the step between `git clone`
# and `yarn dev` (README § Getting started), and it is safe to re-run.
#
# What it does that `cp` does not:
#
#   * Generates a strong random value for every placeholder the templates mark
#     `…-change-me`, so a checkout is not signing its sessions with a key published in
#     this repository.
#   * Gives such a variable ONE value across every file that declares it.
#     `OURO_ENGINE_SHARED_SECRET` is read by ouroboros-rest and by ouroboros-engine and
#     compared between them; two independently generated values there is a stack that
#     answers 401 to every internal call and explains itself nowhere.
#   * Adopts the value already sitting in an existing `.env` instead of generating a
#     second one, so a re-run on a half-configured checkout completes it rather than
#     splitting a pair of secrets that used to agree.
#   * Leaves an existing `.env` alone. That file is the developer's own — it may hold a
#     real GitHub OAuth application, a password for a database somebody else runs — and
#     none of it is reproducible from anything committed. `--force` overwrites, and says
#     which files it replaced.
#
# Everything else in the templates is passed through byte for byte: every default, and
# every line of prose explaining what to edit next. Rendering is
# scripts/lib/render-env.awk; what it produces is then checked by the same parser the
# build holds the templates to, so this cannot write a file the services will not read.
#
# The set of files is discovered from the templates that exist — the repo root, then each
# `ouroboros-*/.env.example` — so a module that gains one is set up here without an edit.
# ouroboros-web reads no environment at all, has no template, and gets no file.
#
# What it deliberately does not do: invent a GitHub OAuth application. Those two values
# stay as the templates leave them, and `yarn dev` signs in without them through issue
# #705's development email/password route; the closing notes say so.
#
# Usage:
#   scripts/setup.sh                      # create whatever is missing
#   scripts/setup.sh --dry-run            # report what it would do, touching nothing
#   scripts/setup.sh --force              # replace the .env files that already exist
#   scripts/setup.sh --db-port 55433      # publish PostgreSQL somewhere other than 5432
#   scripts/setup.sh --root DIR           # set up DIR instead (used by the tests)
#
# Exit status:
#   0  every file that was missing is now there (or --dry-run reported cleanly)
#   1  a file could not be rendered; each reason is printed
#   2  bad command-line usage

set -eu

unset CDPATH
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")
RENDERER="$SCRIPT_DIR/lib/render-env.awk"
VALIDATOR="$SCRIPT_DIR/lib/parse-env-example.awk"
TAB=$(printf '\t')

FORCE=0
DRY_RUN=0
DB_PORT=""

usage() {
  cat <<'EOF'
Usage: scripts/setup.sh [-n|--dry-run] [-f|--force] [--db-port PORT] [--root DIR]

Create the .env files a first-time checkout needs, one per module, from the committed
.env.example beside each. Generates a real secret for every `…-change-me` placeholder,
keeps a secret shared by two modules identical in both, and never overwrites an existing
.env unless asked.

  -n, --dry-run    report what would be written without writing anything
  -f, --force      replace .env files that already exist, keeping their secrets
      --db-port    port to publish PostgreSQL on; OURO_DATABASE_URL is kept in step
      --root DIR   set up the checkout at DIR instead of this script's own
  -h, --help       print this usage
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -n | --dry-run) DRY_RUN=1 ;;
    -f | --force) FORCE=1 ;;
    --db-port)
      shift
      [ $# -gt 0 ] || { printf 'setup: --db-port needs a value\n' >&2; exit 2; }
      case "$1" in
        '' | *[!0-9]*)
          printf 'setup: --db-port takes a port number, not: %s\n' "$1" >&2
          exit 2
          ;;
      esac
      DB_PORT="$1"
      ;;
    --root)
      shift
      [ $# -gt 0 ] || { printf 'setup: --root needs a directory\n' >&2; exit 2; }
      ROOT=$(cd -- "$1" && pwd)
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf 'setup: unknown argument: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

cd "$ROOT"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# --- Helpers -----------------------------------------------------------------

# env_value FILE NAME — print the value FILE assigns to NAME, or nothing.
#
# Reads the file as the loader does: the first `NAME=` line wins, `#` comments are
# comments. Deliberately more forgiving than parse-env-example.awk, because it is pointed
# at files a developer has been editing by hand as well as at the committed templates,
# and a stray quote somewhere else in the file is no reason to fail to read this line.
env_value() {
  [ -f "$1" ] || return 0
  awk -v want="$2" '
    /^[A-Z][A-Z0-9_]*=/ {
      eq = index($0, "=")
      if (substr($0, 1, eq - 1) == want) { print substr($0, eq + 1); exit }
    }
  ' "$1"
}

# declares FILE NAME — true when FILE declares NAME as a variable.
declares() {
  [ -f "$1" ] && grep -qE "^$2=" "$1"
}

# generate_secret — 32 random bytes, base64, on one line.
#
# base64 of urandom rather than a shell RANDOM: this value signs sessions and encrypts
# stored OAuth tokens, and $RANDOM is seeded from the pid on most shells. The alphabet is
# safe in a `.env` unquoted — no whitespace, no `#`, no quote — which is what the parser
# these files are checked against requires.
generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\n'
  elif [ -r /dev/urandom ] && command -v base64 >/dev/null 2>&1; then
    dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64 | tr -d '\n'
  else
    return 1
  fi
}

# port_in_use PORT — true when something on this machine is already listening on PORT.
#
# Best effort and advisory only: none of the tools that can answer is POSIX, so a machine
# with none of them is simply not warned. Being wrong here must never fail a setup.
port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -qE "[:.]$1[[:space:]]"
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | grep -qE "[:.]$1[[:space:]]"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

# --- The templates to render -------------------------------------------------

[ -f "$RENDERER" ] || { printf 'setup: missing %s\n' "$RENDERER" >&2; exit 1; }

# Root first, then each module in name order. A template is what says "this module is
# configured", so the list is discovered rather than written down here and kept in step
# by hand.
templates=""
for template in .env.example ouroboros-*/.env.example; do
  [ -f "$template" ] || continue
  templates="${templates:+$templates }$template"
done

if [ -z "$templates" ]; then
  printf 'setup: no .env.example found in %s — is this an Ouroboros checkout?\n' "$ROOT" >&2
  exit 1
fi

# --- Secrets -----------------------------------------------------------------

# The variables to generate a value for: every one whose committed value ends in
# `-change-me`, which is how the templates mark a placeholder that must not survive into
# a working checkout. Discovering them by that marker rather than listing them here means
# a fourth secret added to a template is generated without touching this script.
#
# The GitHub OAuth pair is deliberately not marked that way in the templates: no script
# can register an OAuth application, so those keep their documented defaults.
placeholders=$(awk '
  /^[A-Z][A-Z0-9_]*=/ {
    eq = index($0, "=")
    if (substr($0, eq + 1) ~ /-change-me$/) print substr($0, 1, eq - 1)
  }
' $templates | sort -u)

: > "$work/secrets.tsv"
generated=0
adopted=0

for name in $placeholders; do
  # A value already in a working .env wins. This is what keeps the two sides of
  # OURO_ENGINE_SHARED_SECRET equal when only one of the two files is missing, and what
  # makes a re-run safe: the secret in the file that survived is the secret the file
  # being written gets.
  value=""
  for template in $templates; do
    existing="${template%.example}"
    found=$(env_value "$existing" "$name")
    case "$found" in
      '' | *-change-me) continue ;;
    esac
    value="$found"
    break
  done

  if [ -n "$value" ]; then
    adopted=$((adopted + 1))
  else
    value=$(generate_secret) || {
      printf 'setup: no way to generate a secret — install openssl, or a base64 with a readable /dev/urandom\n' >&2
      exit 1
    }
    generated=$((generated + 1))
  fi

  printf '%s%s%s\n' "$name" "$TAB" "$value" >> "$work/secrets.tsv"
done

# --- Render ------------------------------------------------------------------

printf '\nEnvironment files — %s%s\n\n' "$ROOT" "$([ "$DRY_RUN" -eq 1 ] && printf ' (dry run)' || true)"

created=0
skipped=0
replaced=0
failed=0

for template in $templates; do
  target="${template%.example}"

  if [ -e "$target" ] && [ "$FORCE" -eq 0 ]; then
    skipped=$((skipped + 1))
    printf '  %-10s %s (already there — --force replaces it)\n' 'keep' "$target"
    continue
  fi

  # The overrides this file takes: the secrets it declares, and nothing else. An override
  # for a variable the template does not declare is an error in the renderer, which is
  # what turns a renamed variable into a failure here rather than a line nothing reads.
  : > "$work/overrides.tsv"
  while IFS="$TAB" read -r name value; do
    if declares "$template" "$name"; then
      printf '%s%s%s\n' "$name" "$TAB" "$value" >> "$work/overrides.tsv"
    fi
  done < "$work/secrets.tsv"

  # A port asked for on the command line has to reach both the variable the compose stack
  # publishes on and the connection string ouroboros-rest dials, which are different
  # variables in different files and are not derived from one another (see the note above
  # OURO_DATABASE_URL in .env.example). Keeping them in step is the whole reason this
  # script offers the flag rather than leaving it to an editor.
  if [ -n "$DB_PORT" ]; then
    if declares "$template" OURO_DB_PORT; then
      printf 'OURO_DB_PORT%s%s\n' "$TAB" "$DB_PORT" >> "$work/overrides.tsv"
    fi
    url=$(env_value "$template" OURO_DATABASE_URL)
    if [ -n "$url" ]; then
      # Only the port component moves: the role, password and database name stay whatever
      # the template documents.
      url=$(printf '%s' "$url" | sed -E "s#(@[^/@]*):[0-9]+/#\1:$DB_PORT/#")
      printf 'OURO_DATABASE_URL%s%s\n' "$TAB" "$url" >> "$work/overrides.tsv"
    fi
  fi

  # Rendered and checked even under --dry-run, and only the install is skipped: a preview
  # that reported a file it would have failed to write would be worth nothing as the
  # preflight it is there to be.
  if ! awk -f "$RENDERER" "$work/overrides.tsv" "$template" > "$work/rendered"; then
    failed=$((failed + 1))
    printf '  %-10s %s (could not be rendered from %s)\n' 'FAIL' "$target" "$template"
    continue
  fi

  # The file is written only once it parses as the services will read it. The validator is
  # the one the build already holds the templates to, in the mode that reads a working
  # copy: prose comments are not owed by a `.env`, every other rule still is.
  if ! awk -v template=0 -f "$VALIDATOR" "$work/rendered" >/dev/null 2>"$work/why"; then
    failed=$((failed + 1))
    printf '  %-10s %s (rendered, but does not parse)\n' 'FAIL' "$target"
    sed 's/^/             /' "$work/why" >&2
    continue
  fi

  was_there=0
  [ -e "$target" ] && was_there=1

  if [ "$DRY_RUN" -eq 1 ]; then
    if [ "$was_there" -eq 1 ]; then
      replaced=$((replaced + 1))
      printf '  %-10s %s (from %s)\n' 'would redo' "$target" "$template"
    else
      created=$((created + 1))
      printf '  %-10s %s (from %s)\n' 'would add' "$target" "$template"
    fi
    continue
  fi

  # The file is created private before anything is written into it: it carries generated
  # signing keys from here on, and a default umask on a shared machine publishes them.
  ( umask 077 && cat "$work/rendered" > "$target" )

  if [ "$was_there" -eq 1 ]; then
    replaced=$((replaced + 1))
    printf '  %-10s %s (from %s)\n' 'replace' "$target" "$template"
  else
    created=$((created + 1))
    printf '  %-10s %s (from %s)\n' 'create' "$target" "$template"
  fi
done

# --- Report ------------------------------------------------------------------

printf '\n'

if [ "$generated" -gt 0 ] || [ "$adopted" -gt 0 ]; then
  printf '  secrets: %s generated' "$generated"
  [ "$adopted" -eq 0 ] || printf ', %s kept from a file that was already here' "$adopted"
  printf '\n'
fi

printf '  %s created, %s replaced, %s left alone' "$created" "$replaced" "$skipped"
[ "$failed" -eq 0 ] || printf ', %s failed' "$failed"
printf '\n'

if [ "$failed" -gt 0 ]; then
  printf '\nsetup: %s file(s) could not be written\n\n' "$failed" >&2
  exit 1
fi

# The port the stack will actually try to publish on, whether it was asked for or taken
# from the template.
db_port="${DB_PORT:-$(env_value .env.example OURO_DB_PORT)}"

if [ -n "$db_port" ] && port_in_use "$db_port"; then
  printf '\n  ! something is already listening on %s, so the database container will not start.\n' "$db_port"
  printf '    Re-run with a free port — this rewrites OURO_DATABASE_URL to match, which\n'
  printf '    nothing else derives for you:\n\n'
  printf '        scripts/setup.sh --force --db-port 55433\n'
fi

if [ "$DRY_RUN" -eq 1 ]; then
  printf '\n  Nothing was written. Re-run without --dry-run.\n\n'
  exit 0
fi

cat <<'EOF'

  Next:

      docker compose up      PostgreSQL, migrated, with the development seed
      yarn dev               the application stack — UI :3000, API :4000, engine :8000

  Sign-in works out of the box under `yarn dev`: running outside production enables an
  email/password route, and the development seed's people have passwords. No GitHub OAuth
  application is involved, and there is no variable to set — there is also no bypass, so
  what you sign in with is a real credential the service checks.

  To exercise the real handshake instead, register a development app whose callback is
  http://localhost:4000/api/auth/callback/github and put its credentials in
  OURO_GITHUB_CLIENT_ID and OURO_GITHUB_CLIENT_SECRET.

  The compose stack (`docker compose --profile full up`) runs the production image, where
  the password route does not exist — GitHub is the only way in there.

EOF
