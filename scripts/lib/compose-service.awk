# compose-service.awk — print one service's block from a Compose file.
#
# The repo's verify-* checks are line-oriented greps over whole files, which is enough
# while a file describes one thing and stops meaning what it says as soon as it describes
# five. `ports:` appears in docker-compose.yml because the database publishes one; that a
# grep for it succeeds says nothing about whether the *engine* publishes one, and the
# engine publishing nothing is a property the stack is supposed to guarantee (#55). This
# narrows the haystack to the service being asserted about, so a check written against
# one service cannot be satisfied by another.
#
# Emits the named service's block, its own `  name:` header line first, with indentation
# preserved so the caller's patterns are the same ones it would write against the file:
#
#   awk -v service=engine -f scripts/lib/compose-service.awk docker-compose.yml
#
# Two kinds of line are dropped, because they are prose rather than configuration and
# this output is read by assertions:
#
# * whole-line comments, and blank lines;
# * a trailing comment — whitespace, `#`, and the rest of the line.
#
# The second is the one limitation worth stating: a `#` inside a quoted scalar would be
# truncated with it. Nothing in this repository's compose file has one, and a check that
# needs such a value should read the file rather than this. Everything else is passed
# through untouched — this is an extractor, not a YAML parser, and it deliberately makes
# no attempt to understand the values it is separating.
#
# Usage:
#   awk -v service=NAME -f scripts/lib/compose-service.awk FILE
#
# Exit status:
#   0  the service was found; its block is on stdout
#   1  no `services:` block, no such service, or no `-v service=` — nothing is printed,
#      and the reason is on stderr
#
# Printing nothing on failure is deliberate: a caller asserting that a service does *not*
# declare something must not be handed an empty block by a typo in the service name and
# read it as a satisfied assertion.

BEGIN {
    if (service == "") {
        printf "compose-service: no service named — pass -v service=NAME\n" > "/dev/stderr"
        bail = 1
        exit 1
    }
    in_services = 0
    in_block = 0
    found = 0
    lines = 0
}

{
    line = $0
    sub(/\r$/, "", line)              # tolerate a CRLF checkout

    if (line ~ /^[ \t]*$/) next       # blank
    if (line ~ /^[ \t]*#/) next       # whole-line comment
    sub(/[ \t]+#.*$/, "", line)       # trailing comment
    sub(/[ \t]+$/, "", line)

    indent = match(line, /[^ ]/) - 1

    # A top-level key closes whatever was open. `services:` opens the only region a
    # service can be found in, so a `ui:` under `networks:` is never mistaken for one.
    if (indent == 0) {
        in_block = 0
        in_services = (line ~ /^services:[ \t]*$/)
        next
    }

    if (!in_services) next

    # A service header — the block being read ends here whether or not the next one is
    # the wanted service.
    if (indent == 2 && line ~ /^  [A-Za-z0-9_.-]+:[ \t]*$/) {
        name = line
        sub(/^  /, "", name)
        sub(/:[ \t]*$/, "", name)

        in_block = (name == service)
        if (in_block) {
            if (found) {
                printf "compose-service: %s declared twice\n", service > "/dev/stderr"
                bail = 1
                exit 1
            }
            found = 1
            out[++lines] = line
        }
        next
    }

    if (in_block) out[++lines] = line
}

END {
    if (bail) exit 1

    if (!found) {
        printf "compose-service: no service named %s in %s\n", service, FILENAME > "/dev/stderr"
        exit 1
    }

    for (i = 1; i <= lines; i++) print out[i]
}
