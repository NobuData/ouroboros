# parse-workflow-paths.awk — validate a workflow's `on:` block and flatten its path
# filters to TSV.
#
# Emits one line per workflow, path-filterable event and glob:
#
#   <file><TAB><event><TAB><glob>
#
# Diagnostics go to stderr. A run with any problem emits nothing at all and exits 1, so
# a caller can never read half an `on:` block and conclude a workflow is narrower than
# it is. Several files may be passed at once; the file column keeps them apart.
#
# Only `push`, `pull_request` and `pull_request_target` are emitted, because they are
# the only events GitHub filters by path. An event of those three that declares no
# `paths:` runs for every change, and is emitted with the glob `**` — so a caller
# reasoning about which workflow a file triggers never has to special-case it, and an
# accidentally unfiltered workflow shows up as exactly what it is.
#
# The accepted grammar is deliberately narrow — the block form this repository writes:
#
#   on:
#     pull_request:
#       branches: [main]
#       paths:
#         - "ouroboros-ui/**"          # trailing comments are allowed
#     workflow_dispatch:
#
# Blank lines and whole-line `#` comments are ignored, as is anything nested deeper than
# a `paths:` entry. `paths-ignore:`, flow-style `paths: [...]` and a sequence-style `on:`
# are refused rather than guessed at: each would change which files trigger a workflow
# while looking, to a reader of this output, like it changed nothing.
#
# Usage:
#   awk -f scripts/lib/parse-workflow-paths.awk .github/workflows/*.yml
#
# Exit status:
#   0  every file valid; TSV written to stdout
#   1  at least one problem; each is printed to stderr as `<file>:<line>: <reason>`

BEGIN {
    split("push pull_request pull_request_target", filterable, " ")
    for (i in filterable) is_filterable[filterable[i]] = 1

    errors = 0
    records = 0
    cur_file = ""
}

# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------

# report MESSAGE — record a problem against the line being read.
function report(message) {
    printf "%s:%d: %s\n", FILENAME, FNR, message > "/dev/stderr"
    errors++
}

# report_file MESSAGE — record a problem against a whole file.
function report_file(file, message) {
    printf "%s: %s\n", file, message > "/dev/stderr"
    errors++
}

# ---------------------------------------------------------------------------
# Accumulation
# ---------------------------------------------------------------------------

# emit EVENT, GLOB — hold a record for output.
function emit(event_name, glob) {
    records++
    out[records] = cur_file "\t" event_name "\t" glob
}

# end_event — close the event being read. One that never declared `paths:` matches
# every file, which is what the `**` stands for.
function end_event() {
    if (event != "" && is_filterable[event] && !has_paths) emit(event, "**")
    event = ""
    has_paths = 0
    in_paths = 0
}

# end_file — close the file being read.
function end_file() {
    end_event()
    if (cur_file != "" && !saw_on)
        report_file(cur_file, "no top-level `on:` block — nothing triggers this workflow")
    in_on = 0
    saw_on = 0
}

# ---------------------------------------------------------------------------
# Line dispatch
# ---------------------------------------------------------------------------

FNR == 1 {
    end_file()
    cur_file = FILENAME
    delete seen_glob
}

{
    line = $0
    sub(/\r$/, "", line)          # tolerate a CRLF checkout
    sub(/[ \t]+$/, "", line)

    if (line ~ /^[ \t]*$/) next
    if (line ~ /^[ \t]*#/) next

    if (line ~ /^ *\t/) {
        report("tab indentation — YAML forbids tabs outright")
        next
    }

    indent = match(line, /[^ ]/) - 1
    key = substr(line, indent + 1)

    # ---- top level ----------------------------------------------------------
    if (indent == 0) {
        end_event()
        in_on = 0
        if (key ~ /^on:[ \t]*(#.*)?$/) {
            in_on = 1
            saw_on = 1
        } else if (key ~ /^on:/) {
            # `on: push` and `on: [push]` carry no room for a `paths:` filter, so a
            # workflow written that way runs for every change however it looks.
            report("`on:` must open a block mapping — a scalar or flow form cannot be path-filtered")
            saw_on = 1
        }
        next
    }

    if (!in_on) next

    # ---- events -------------------------------------------------------------
    if (indent == 2) {
        end_event()
        if (key ~ /^- /) {
            report("`on:` is a sequence of event names — the mapping form is required so events can be filtered")
            next
        }
        if (key !~ /^[a-z_][a-z0-9_]*:[ \t]*(#.*)?$/) {
            report("expected an event name and nothing else, got: [" key "]")
            next
        }
        event = key
        sub(/:.*$/, "", event)
        next
    }

    # ---- event settings -----------------------------------------------------
    if (indent == 4) {
        in_paths = 0
        if (event == "") {
            report("setting outside any event: [" key "]")
            next
        }
        if (key ~ /^paths-ignore[ \t]*:/) {
            report("paths-ignore: is not used here — an exclusion cannot be read as the set of paths that trigger the workflow")
            next
        }
        if (key ~ /^paths[ \t]*:[ \t]*(#.*)?$/) {
            if (has_paths) report("paths: declared twice for " event)
            has_paths = 1
            in_paths = 1
            next
        }
        if (key ~ /^paths[ \t]*:/) {
            report("paths: must be a block sequence, one quoted glob per line")
            next
        }
        next
    }

    # ---- path globs ---------------------------------------------------------
    # Anything deeper that is not a glob — a block-style `branches:` list, a nested
    # mapping — is somebody else's business and is passed over.
    if (indent == 6 && in_paths) {
        if (key !~ /^- "/) {
            report("expected a double-quoted glob, got: [" key "]")
            next
        }
        rest = key
        sub(/^- "/, "", rest)
        quote_end = index(rest, "\"")
        if (quote_end == 0) {
            report("quoted glob is not closed")
            next
        }
        glob = substr(rest, 1, quote_end - 1)
        tail = substr(rest, quote_end + 1)
        if (tail !~ /^[ \t]*(#.*)?$/) {
            report("unexpected text after the closing quote (a glob may not contain a double quote)")
            next
        }
        if (glob == "") {
            report("empty glob")
            next
        }
        if (index(glob, "\t") > 0) {
            report("glob contains a tab, which would corrupt the emitted record")
            next
        }
        if ((event SUBSEP glob) in seen_glob) {
            report("duplicate glob for " event ": " glob)
            next
        }
        seen_glob[event, glob] = 1
        emit(event, glob)
        next
    }
}

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

END {
    end_file()

    if (records == 0 && errors == 0) {
        printf "no path-filterable events found in the file(s) given\n" > "/dev/stderr"
        errors++
    }
    if (errors > 0) {
        printf "%d problem(s) — no path filters emitted\n", errors > "/dev/stderr"
        exit 1
    }
    for (i = 1; i <= records; i++) print out[i]
}
