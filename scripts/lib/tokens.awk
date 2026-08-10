# tokens.awk — read docs/design/tokens.css.
#
# The token sheet is three rules and nothing else: `:root` carrying the light palette and
# everything theme-independent, `:root[data-theme="dark"]` carrying the dark palette, and
# the same dark palette again under `@media (prefers-color-scheme: dark)` for the case
# where no choice has been stamped yet. This reads one of them, or reads what is left over.
#
# Usage:
#   awk -f scripts/lib/tokens.awk -v block=light  docs/design/tokens.css
#   awk -f scripts/lib/tokens.awk -v block=dark   docs/design/tokens.css
#   awk -f scripts/lib/tokens.awk -v block=system docs/design/tokens.css
#   awk -f scripts/lib/tokens.awk -v mode=outside docs/design/tokens.css
#
# `mode=declarations` (the default) emits one line per declaration in the chosen block:
#
#   <property><TAB><value>
#
# in file order, comments removed and whitespace inside the value collapsed — so two
# blocks that should be identical compare with a plain diff, and a caller looking up one
# token does not have to know how it was formatted.
#
# `mode=outside` emits every non-blank line that is not inside one of the three blocks:
#
#   <line-number><TAB><text>
#
# A well-formed sheet emits nothing at all, which is how verify-tokens.sh asserts that no
# colour literal — indeed no declaration of any kind — lives outside the palette blocks.
#
# A rule whose selector is not one of the three is refused rather than skipped: a component
# style in the token sheet is a design-system mistake, and silently ignoring it would let
# literal colours in through a door this parser is supposed to be watching. Nesting is one
# level (the media query), which is all the sheet's structure allows.
#
# Braces, semicolons and comments are scanned rather than matched line by line, so how the
# sheet is formatted — one declaration per line, a whole rule on one line, a value wrapped
# over two — changes what it means to nobody.
#
# Exit status:
#   0  the block was found; its declarations (or the leftover lines) were written
#   1  the requested block is missing, or the sheet has a shape this parser refuses
#      (each reason is printed to stderr as `<file>:<line>: <reason>`)

BEGIN {
    if (block == "") {
        block = "light"
    }
    if (mode == "") {
        mode = "declarations"
    }
    if (mode != "declarations" && mode != "outside") {
        printf "tokens: unknown mode: %s\n", mode > "/dev/stderr"
        exit 1
    }
    if (mode == "declarations" && block != "light" && block != "dark" && block != "system") {
        printf "tokens: unknown block: %s\n", block > "/dev/stderr"
        exit 1
    }

    in_comment = 0      # inside a /* … */ that has not closed yet
    in_media = 0        # inside the prefers-color-scheme: dark media query
    current = ""        # the block whose declarations are being read, "" outside one
    unknown = 0         # depth of rules whose selector was already refused
    buffer = ""         # text read since the last brace or semicolon
    emitted = 0
    errors = 0
}

{
    scan(strip_comments($0))
}

END {
    if (in_comment) {
        report("unterminated comment")
    }
    if (trim(buffer) != "") {
        report("unterminated declaration: " trim(buffer))
    }
    if (current != "" || in_media || unknown > 0) {
        report("unterminated block")
    }
    if (errors > 0) {
        exit 1
    }
    if (mode == "declarations" && emitted == 0) {
        printf "tokens: no declarations found in the %s block\n", block > "/dev/stderr"
        exit 1
    }
}

# report MESSAGE — record a shape this parser refuses.
function report(message) {
    printf "%s:%d: %s\n", FILENAME, FNR, message > "/dev/stderr"
    errors++
}

# trim TEXT — TEXT without leading or trailing whitespace.
function trim(text) {
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", text)
    return text
}

# strip_comments TEXT — TEXT with every /* … */ removed, carrying the open state across
# lines. A comment is whitespace as far as CSS is concerned, so it becomes a space.
function strip_comments(text,    out, position) {
    out = ""
    while (text != "") {
        if (in_comment) {
            position = index(text, "*/")
            if (position == 0) {
                return out
            }
            text = substr(text, position + 2)
            in_comment = 0
            out = out " "
            continue
        }
        position = index(text, "/*")
        if (position == 0) {
            return out text
        }
        out = out substr(text, 1, position - 1)
        text = substr(text, position + 2)
        in_comment = 1
    }
    return out
}

# first_delimiter TEXT — the position of the first `{`, `}` or `;`, or 0 if there is none.
function first_delimiter(text,    i, at, best) {
    best = 0
    for (i = 1; i <= 3; i++) {
        at = index(text, substr("{};", i, 1))
        if (at > 0 && (best == 0 || at < best)) {
            best = at
        }
    }
    return best
}

# scan TEXT — read one comment-free line, acting on each brace and semicolon in it.
#
# Text that arrives without a delimiter is held in `buffer` for the next line, which is what
# lets a selector or a value wrap.
function scan(text,    at, delimiter) {
    while (text != "") {
        at = first_delimiter(text)
        if (at == 0) {
            buffer = buffer text
            return
        }
        delimiter = substr(text, at, 1)
        buffer = buffer substr(text, 1, at - 1)
        text = substr(text, at + 1)

        if (delimiter == "{") {
            open_rule(trim(buffer))
            buffer = ""
        } else if (delimiter == "}") {
            take_declaration()
            close_rule()
        } else {
            take_declaration()
        }
    }
}

# block_of SELECTOR — which of the three blocks a selector opens, or "" for none.
function block_of(selector) {
    if (selector == ":root") {
        return "light"
    }
    if (selector == ":root[data-theme=\"dark\"]") {
        return "dark"
    }
    if (selector == ":root:not([data-theme=\"light\"])" && in_media) {
        return "system"
    }
    return ""
}

# open_rule SELECTOR — enter the media query, enter a palette block, or refuse.
function open_rule(selector) {
    if (unknown > 0) {
        unknown++
        return
    }

    if (selector ~ /^@/) {
        if (selector !~ /^@media/) {
            report("the token sheet carries no at-rule but @media: " selector)
            unknown++
        } else if (selector !~ /prefers-color-scheme:[[:space:]]*dark/) {
            report("the only @media the token sheet may carry is prefers-color-scheme: dark")
            unknown++
        } else if (in_media || current != "") {
            report("nested @media")
            unknown++
        } else {
            in_media = 1
        }
        return
    }

    if (current != "") {
        report("nested rule inside the " current " block")
        unknown++
        return
    }

    current = block_of(selector)
    if (current == "") {
        report("the token sheet carries only palette blocks, not: " selector)
        unknown++
    }
}

# close_rule — leave whatever the matching brace opened.
function close_rule() {
    if (unknown > 0) {
        unknown--
    } else if (current != "") {
        current = ""
    } else if (in_media) {
        in_media = 0
    } else {
        report("unbalanced }")
    }
}

# take_declaration — act on the text held since the last delimiter, and clear it.
#
# Inside the requested block it is emitted; inside another palette block it is skipped;
# inside a rule that was already refused it is ignored, because the refusal has been
# reported once and every declaration in it would report it again. Outside every block it is
# the leftover `mode=outside` exists to find.
function take_declaration(    text, property, value) {
    text = trim(buffer)
    buffer = ""
    if (text == "") {
        return
    }

    if (unknown > 0) {
        return
    }

    if (current == "") {
        if (mode == "outside") {
            printf "%d\t%s\n", FNR, text ";"
            emitted++
        } else {
            report("declaration outside a palette block: " text)
        }
        return
    }

    if (mode != "declarations" || current != block) {
        return
    }

    if (index(text, ":") == 0) {
        report("not a declaration: " text)
        return
    }
    property = trim(substr(text, 1, index(text, ":") - 1))
    value = trim(substr(text, index(text, ":") + 1))
    gsub(/[[:space:]]+/, " ", value)
    if (property == "" || value == "") {
        report("not a declaration: " text)
        return
    }
    printf "%s\t%s\n", property, value
    emitted++
}
