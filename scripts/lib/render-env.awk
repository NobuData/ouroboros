# render-env.awk — render a working .env from its committed template.
#
# Reads two files, in this order:
#
#   1. an overrides table, one `NAME<TAB>VALUE` per line;
#   2. the `.env.example` to render.
#
# Writes the template to stdout with each overridden variable's value replaced, and
# everything else — every comment, every blank line, every assignment nobody overrode —
# passed through unchanged. The prose is the point: these templates explain what each
# variable is for and what breaks when it is wrong, and a `.env` produced by stripping
# that down to bare assignments would answer none of the questions a developer opens it
# with.
#
# A variable is a line opening with `NAME=` in the same upper-snake-case shape
# parse-env-example.awk accepts. A `#` comment that happens to contain an `=` is a
# comment, and stays one.
#
# An override naming a variable the template does not declare is an error rather than a
# line appended at the end: it means the two have drifted — the variable was renamed, or
# the caller has a typo — and appending would write a value nothing reads into a file
# that looks correct.
#
# Nothing is written until the whole render succeeds, so a caller can never be left
# holding half a file. That is parse-env-example.awk's rule too, for the same reason.
#
# Usage:
#   awk -f scripts/lib/render-env.awk overrides.tsv .env.example > .env
#
# Exit status:
#   0  rendered; the result is on stdout
#   1  at least one problem; each is printed to stderr and stdout stays empty

BEGIN {
    # The first argument is the overrides table, the second the template. Matching on the
    # name rather than on the usual `NR == FNR` is deliberate: an empty overrides file
    # would make that test true for the template's first line and silently eat it.
    overrides = ARGV[1]

    lines = 0
    errors = 0
}

# report MESSAGE — record a problem against the line being read.
function report(message) {
    printf "%s:%d: %s\n", FILENAME, FNR, message > "/dev/stderr"
    errors++
}

# ---------------------------------------------------------------------------
# The overrides table
# ---------------------------------------------------------------------------

FILENAME == overrides {
    if ($0 ~ /^[[:space:]]*$/) next

    tab = index($0, "\t")
    if (tab == 0) {
        report("not a NAME<TAB>VALUE override: [" $0 "]")
        next
    }

    name = substr($0, 1, tab - 1)
    value = substr($0, tab + 1)

    if (name !~ /^[A-Z][A-Z0-9_]*$/) {
        report("override name is not upper snake case: [" name "]")
        next
    }

    if (name in want) {
        report("duplicate override: " name)
        next
    }

    # The same rule the templates are held to: a variable with no value is one the
    # copied file cannot run on.
    if (value == "") {
        report(name " overrides with an empty value")
        next
    }

    want[name] = value
    next
}

# ---------------------------------------------------------------------------
# The template
# ---------------------------------------------------------------------------

{
    lines++
    out[lines] = $0

    eq = index($0, "=")
    if (eq > 1) {
        name = substr($0, 1, eq - 1)
        if (name ~ /^[A-Z][A-Z0-9_]*$/ && name in want) {
            out[lines] = name "=" want[name]
            applied[name]++
        }
    }
}

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------

END {
    for (name in want) {
        if (!(name in applied)) {
            printf "%s: %s is not declared by %s\n", overrides, name, FILENAME > "/dev/stderr"
            errors++
        } else if (applied[name] > 1) {
            printf "%s: %s is declared more than once\n", FILENAME, name > "/dev/stderr"
            errors++
        }
    }

    if (errors > 0) exit 1

    for (i = 1; i <= lines; i++) print out[i]
}
