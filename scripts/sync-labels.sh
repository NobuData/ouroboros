#!/usr/bin/env sh
#
# sync-labels.sh — reconcile a repository's GitHub labels with .github/labels.yml.
#
# Creates labels that are missing and updates those whose color or description has
# drifted; labels that already match are left untouched, so the script is idempotent and
# safe to re-run. Filed as issue #9, which asks that the label set be recreatable from
# the committed definitions.
#
# It never deletes. A label present on GitHub but absent from the file is reported as an
# extra and left alone, because deleting a label silently strips it from every issue and
# pull request carrying it — a judgement call for a human, not a sync script.
#
# Usage:
#   scripts/sync-labels.sh [-n|--dry-run] [-r|--repo <owner>/<name>] [-f|--file <path>]
#
#   -n, --dry-run   report what would change without touching GitHub
#   -r, --repo      target repository; defaults to the one this checkout points at
#   -f, --file      label definitions to apply; defaults to .github/labels.yml
#   -h, --help      print this usage
#
# Requires the GitHub CLI (gh), authenticated with permission to edit labels.
#
# Exit status:
#   0  every label in the file is present and current on GitHub
#   1  the label file is invalid, gh is missing/unauthenticated, or a label failed
#   2  bad command-line usage

set -eu

unset CDPATH
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")
LABELS_FILE="$ROOT/.github/labels.yml"
PARSER="$SCRIPT_DIR/lib/parse-labels.awk"
TAB=$(printf '\t')

DRY_RUN=0
REPO=""

usage() {
  cat <<'EOF'
Usage: scripts/sync-labels.sh [-n|--dry-run] [-r|--repo <owner>/<name>] [-f|--file <path>]

Reconcile the repository's GitHub labels with .github/labels.yml: missing labels are
created, drifted ones are updated, and nothing is ever deleted.

  -n, --dry-run   report what would change without touching GitHub
  -r, --repo      target repository; defaults to the one this checkout points at
  -f, --file      label definitions to apply; defaults to .github/labels.yml
  -h, --help      print this usage
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -n | --dry-run) DRY_RUN=1 ;;
    -r | --repo)
      shift
      [ $# -gt 0 ] || { printf 'sync-labels: --repo needs a value\n' >&2; exit 2; }
      REPO="$1"
      ;;
    -f | --file)
      shift
      [ $# -gt 0 ] || { printf 'sync-labels: --file needs a value\n' >&2; exit 2; }
      LABELS_FILE="$1"
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf 'sync-labels: unknown argument: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

# --- Preconditions -----------------------------------------------------------

if ! command -v gh >/dev/null 2>&1; then
  printf 'sync-labels: the GitHub CLI is required — see https://cli.github.com\n' >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  printf 'sync-labels: gh is not authenticated — run `gh auth login`\n' >&2
  exit 1
fi

if [ ! -f "$LABELS_FILE" ]; then
  printf 'sync-labels: no label definitions at %s\n' "$LABELS_FILE" >&2
  exit 1
fi

if [ -z "$REPO" ]; then
  REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner) || {
    printf 'sync-labels: could not determine the repository — pass --repo <owner>/<name>\n' >&2
    exit 1
  }
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# --- Desired state, from the committed definitions ---------------------------

if ! awk -f "$PARSER" "$LABELS_FILE" > "$work/desired.tsv"; then
  printf 'sync-labels: %s is invalid — nothing was changed\n' "$LABELS_FILE" >&2
  exit 1
fi

# --- Current state, from GitHub ----------------------------------------------

if ! gh api --paginate "repos/$REPO/labels" \
  --jq '.[] | [.name, .color, .description] | @tsv' > "$work/existing.tsv"; then
  printf 'sync-labels: could not read the labels of %s\n' "$REPO" >&2
  exit 1
fi

# --- Reconcile ---------------------------------------------------------------

printf '\nLabels — %s%s\n\n' "$REPO" "$([ "$DRY_RUN" -eq 1 ] && printf ' (dry run)' || true)"

created=0
updated=0
unchanged=0
failed=0

# lower TEXT — fold to lower case, so hex colors compare regardless of how they are typed.
lower() {
  printf '%s' "$1" | tr 'ABCDEF' 'abcdef'
}

# apply ACTION NAME COLOR DESCRIPTION — create or edit one label, honouring --dry-run.
# ACTION is "create" or "update"; returns non-zero if gh rejected the change.
# Parameters are underscore-prefixed because POSIX shell has no locals and the caller's
# loop variables share their names.
apply() {
  _action=$1
  _name=$2
  _color=$3
  _description=$4

  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi
  if [ "$_action" = "create" ]; then
    gh label create "$_name" --color "$_color" --description "$_description" \
      --repo "$REPO" >/dev/null 2>&1 </dev/null
  else
    gh label edit "$_name" --color "$_color" --description "$_description" \
      --repo "$REPO" >/dev/null 2>&1 </dev/null
  fi
}

while IFS="$TAB" read -r name color description; do
  [ -n "$name" ] || continue

  current=$(awk -F"$TAB" -v want="$name" '$1 == want { print; exit }' "$work/existing.tsv")

  if [ -z "$current" ]; then
    if apply create "$name" "$color" "$description"; then
      created=$((created + 1))
      printf '  %-9s %s\n' "$([ "$DRY_RUN" -eq 1 ] && printf '+ would' || printf '+ create')" "$name"
    else
      failed=$((failed + 1))
      printf '  %-9s %s (gh label create failed)\n' 'FAIL' "$name"
    fi
    continue
  fi

  current_color=$(printf '%s' "$current" | cut -f2)
  current_description=$(printf '%s' "$current" | cut -f3)

  if [ "$(lower "$current_color")" = "$(lower "$color")" ] &&
    [ "$current_description" = "$description" ]; then
    unchanged=$((unchanged + 1))
    printf '  %-9s %s\n' 'ok' "$name"
    continue
  fi

  drift=""
  [ "$(lower "$current_color")" = "$(lower "$color")" ] || drift="color"
  if [ "$current_description" != "$description" ]; then
    drift="${drift:+$drift, }description"
  fi

  if apply update "$name" "$color" "$description"; then
    updated=$((updated + 1))
    printf '  %-9s %s (%s)\n' "$([ "$DRY_RUN" -eq 1 ] && printf '~ would' || printf '~ update')" "$name" "$drift"
  else
    failed=$((failed + 1))
    printf '  %-9s %s (gh label edit failed)\n' 'FAIL' "$name"
  fi
done < "$work/desired.tsv"

# --- Extras: on GitHub, not in the file --------------------------------------

cut -f1 "$work/desired.tsv" | sort > "$work/desired-names"
cut -f1 "$work/existing.tsv" | sort > "$work/existing-names"
comm -13 "$work/desired-names" "$work/existing-names" > "$work/extras"

if [ -s "$work/extras" ]; then
  printf '\nOn GitHub but not in %s — left alone:\n' "${LABELS_FILE#"$ROOT"/}"
  while IFS= read -r extra; do
    printf '  %-9s %s\n' '?' "$extra"
  done < "$work/extras"
fi

printf '\n%s created, %s updated, %s unchanged, %s failed\n\n' \
  "$created" "$updated" "$unchanged" "$failed"

[ "$failed" -eq 0 ]
