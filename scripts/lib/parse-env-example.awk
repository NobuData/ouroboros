# parse-env-example.awk — validate .env.example and flatten it to TSV.
#
# Emits one line per variable on stdout:
#
#   <name><TAB><value>
#
# Diagnostics go to stderr. A file with any problem emits nothing at all and exits 1, so
# a caller can never read half a template and conclude a variable is undeclared.
#
# The accepted grammar is deliberately narrow, because this file is parsed by three
# different things — Docker Compose, every module's config loader, and a developer
# copying it to .env — and only the intersection of what they all accept is safe:
#
#   # What the variable is for, in prose.
#   OURO_DB_USER=ouroboros
#
# Blank lines and whole-line `#` comments are ignored. `export` prefixes, quoted values,
# inline comments and whitespace around `=` are rejected rather than guessed at.
#
# Validated per entry:
#   * names unique, and shaped [A-Z][A-Z0-9_]*;
#   * names carry the OURO_ prefix unless they are a platform standard (docs/
#     CONVENTIONS.md § 4) — the prefix rule is the one this file exists to demonstrate;
#   * values non-empty, so a copied template runs without further editing;
#   * every entry documented — its blank-line-delimited block opens with a comment
#     carrying actual prose, not just a section rule.
#
# Usage:
#   awk -f scripts/lib/parse-env-example.awk .env.example
#
# Exit status:
#   0  every entry valid; TSV written to stdout
#   1  at least one problem; each is printed to stderr as `<file>:<line>: <reason>`

BEGIN {
    # Unprefixed names the conventions allow: the port every container platform sets,
    # plus the standard runtime and Compose variables. Anything else must be OURO_*.
    split("PORT NODE_ENV HOSTNAME COMPOSE_PROJECT_NAME COMPOSE_FILE", allowed, " ")
    for (i in allowed) unprefixed[allowed[i]] = 1

    entries = 0
    errors = 0

    # Set by a prose comment, cleared by a blank line: "this block explains itself".
    documented = 0
}

# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------

# report MESSAGE — record a problem against the line being read.
function report(message) {
    printf "%s:%d: %s\n", FILENAME, FNR, message > "/dev/stderr"
    errors++
}

# ---------------------------------------------------------------------------
# Structure
# ---------------------------------------------------------------------------

# A blank line closes the current block, so the next entry needs its own comment.
/^[[:space:]]*$/ {
    documented = 0
    next
}

# Comments document the block they open. A rule of dashes or equals signs carries no
# prose, so it does not count as documentation on its own.
/^[[:space:]]*#/ {
    if ($0 ~ /[A-Za-z]/) documented = 1
    next
}

# ---------------------------------------------------------------------------
# Entries
# ---------------------------------------------------------------------------

{
    line = $0

    if (line ~ /^[[:space:]]*export[[:space:]]/) {
        report("`export` prefix: .env is read as key=value, not as shell")
        next
    }

    if (line ~ /^[[:space:]]/) {
        report("leading whitespace before a variable name")
        next
    }

    eq = index(line, "=")
    if (eq == 0) {
        report("not a NAME=VALUE assignment: [" line "]")
        next
    }

    name = substr(line, 1, eq - 1)
    value = substr(line, eq + 1)

    if (name ~ /[[:space:]]$/ || value ~ /^[[:space:]]/) {
        report("whitespace around `=` in [" name "]: it becomes part of the value")
        next
    }

    if (name !~ /^[A-Z][A-Z0-9_]*$/) {
        report("variable name is not upper snake case: [" name "]")
        next
    }

    if (name in seen) {
        report("duplicate variable: " name " (first declared on line " seen[name] ")")
        next
    }
    seen[name] = FNR

    if (name !~ /^OURO_/ && !(name in unprefixed)) {
        report(name " needs the OURO_ prefix (docs/CONVENTIONS.md § 4)")
        next
    }

    if (value == "") {
        report(name " has no value: the template must run as-is once copied")
        next
    }

    if (value ~ /^["']/) {
        report(name " quotes its value: quotes are kept literally by some readers")
        next
    }

    if (value ~ /[[:space:]]#/) {
        report(name " has a trailing inline comment: put it on its own line above")
        next
    }

    if (!documented) {
        report(name " is undeclared in prose: add a comment above it")
        next
    }

    entries++
    records[entries] = name "\t" value
}

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------

END {
    if (entries == 0 && errors == 0) {
        printf "%s: no variables found\n", FILENAME > "/dev/stderr"
        errors++
    }

    if (errors > 0) exit 1

    for (i = 1; i <= entries; i++) print records[i]
}
