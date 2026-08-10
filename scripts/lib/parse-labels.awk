# parse-labels.awk — validate .github/labels.yml and flatten it to TSV.
#
# Emits one line per label on stdout:
#
#   <name><TAB><color><TAB><description>
#
# Diagnostics go to stderr. A file with any problem emits nothing at all and exits 1,
# so a caller can never half-apply a broken label set.
#
# The accepted grammar is deliberately narrow — a top-level list whose every entry is
# exactly `name`, `color` and `description`, each value double-quoted:
#
#   - name: "mvp"
#     color: "3dd6f5"                    # trailing comments are allowed
#     description: "Targeted for the v1 / MVP release"
#
# Blank lines and whole-line `#` comments are ignored. Anything else is an error, so a
# typo fails loudly rather than silently syncing the wrong labels. Values may not
# contain a double quote.
#
# Validated per entry: names unique and <= 50 characters, colors exactly six hex digits
# with no leading `#`, descriptions non-empty and <= 100 characters — GitHub's own
# limits, checked here so `gh label create` never fails halfway through a sync.
#
# Usage:
#   awk -f scripts/lib/parse-labels.awk .github/labels.yml
#
# Exit status:
#   0  every entry valid; TSV written to stdout
#   1  at least one problem; each is printed to stderr as `<file>:<line>: <reason>`

BEGIN {
    MAX_NAME_CHARS = 50
    MAX_DESC_CHARS = 100

    # gawk in a UTF-8 locale measures strings in characters already; byte-oriented awks
    # (mawk, busybox) do not and need their continuation bytes discounted, or an em-dash
    # would count as three characters against GitHub's limit.
    counts_characters = (length("é") == 1)

    entries = 0
    errors = 0
    entry_open = 0
}

# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------

# report_at LINE_NO, MESSAGE — record a problem against a specific input line.
function report_at(line_no, message) {
    printf "%s:%d: %s\n", FILENAME, line_no, message > "/dev/stderr"
    errors++
}

# report MESSAGE — record a problem against the line being read.
function report(message) {
    report_at(FNR, message)
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# char_count TEXT — length of TEXT in characters, whichever awk is running.
function char_count(text,   stripped, continuations) {
    if (counts_characters) return length(text)
    stripped = text
    continuations = gsub(/[\200-\277]/, "", stripped)
    return length(text) - continuations
}

# read_value LINE, KEY — the double-quoted value of KEY on LINE.
# Returns "" and records a problem if the line is not `KEY: "value"` with nothing after
# the closing quote but optional whitespace and a `#` comment.
function read_value(line, key,   rest, quote_end, value, tail) {
    rest = line
    sub(/^[ \t]*-?[ \t]*/, "", rest)
    sub("^" key "[ \t]*:[ \t]*", "", rest)

    if (substr(rest, 1, 1) != "\"") {
        report(key ": value must be wrapped in double quotes")
        return ""
    }
    quote_end = index(substr(rest, 2), "\"")
    if (quote_end == 0) {
        report(key ": quoted value is not closed")
        return ""
    }
    value = substr(rest, 2, quote_end - 1)
    tail = substr(rest, quote_end + 2)
    if (tail !~ /^[ \t]*(#.*)?$/) {
        report(key ": unexpected text after the closing quote (a value may not contain a double quote)")
        return ""
    }
    if (value == "") {
        report(key ": value is empty")
        return ""
    }
    if (index(value, "\t") > 0) {
        report(key ": value contains a tab, which would corrupt the emitted record")
        return ""
    }
    return value
}

# finish_entry — validate the entry being accumulated and hold it for output.
function finish_entry() {
    if (!entry_open) return

    if (entry_color == "") report_at(entry_line, "label \"" entry_name "\": no color")
    if (entry_desc == "") report_at(entry_line, "label \"" entry_name "\": no description")

    entries++
    out_name[entries] = entry_name
    out_color[entries] = entry_color
    out_desc[entries] = entry_desc
    entry_open = 0
}

# ---------------------------------------------------------------------------
# Line dispatch
# ---------------------------------------------------------------------------

{
    line = $0
    sub(/\r$/, "", line)          # tolerate a CRLF checkout
    sub(/[ \t]+$/, "", line)

    if (line ~ /^[ \t]*$/) next
    if (line ~ /^[ \t]*#/) next

    if (line ~ /^-[ \t]+name[ \t]*:/) {
        finish_entry()
        entry_open = 1
        entry_line = FNR
        entry_color = ""
        entry_desc = ""
        entry_name = read_value(line, "name")

        if (entry_name != "") {
            if (char_count(entry_name) > MAX_NAME_CHARS)
                report("name: \"" entry_name "\" is longer than " MAX_NAME_CHARS " characters")
            if (entry_name in seen)
                report("name: \"" entry_name "\" duplicates the entry on line " seen[entry_name])
            else
                seen[entry_name] = FNR
        }
        next
    }

    if (line ~ /^[ \t]+color[ \t]*:/) {
        if (!entry_open) {
            report("color: appears before any `- name:` entry")
            next
        }
        entry_color = read_value(line, "color")
        if (entry_color ~ /^#/)
            report("color: drop the leading # — six hex digits only")
        else if (entry_color != "" && entry_color !~ /^[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]$/)
            report("color: \"" entry_color "\" is not six hex digits")
        next
    }

    if (line ~ /^[ \t]+description[ \t]*:/) {
        if (!entry_open) {
            report("description: appears before any `- name:` entry")
            next
        }
        entry_desc = read_value(line, "description")
        if (char_count(entry_desc) > MAX_DESC_CHARS)
            report("description: longer than " MAX_DESC_CHARS " characters (" char_count(entry_desc) ")")
        next
    }

    report("unrecognised line — expected `- name:`, `color:`, `description:`, a comment, or a blank line")
}

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

END {
    finish_entry()

    if (entries == 0) {
        printf "%s: no labels found\n", FILENAME > "/dev/stderr"
        errors++
    }
    if (errors > 0) {
        printf "%s: %d problem(s) — no labels emitted\n", FILENAME, errors > "/dev/stderr"
        exit 1
    }
    for (i = 1; i <= entries; i++)
        printf "%s\t%s\t%s\n", out_name[i], out_color[i], out_desc[i]
}
