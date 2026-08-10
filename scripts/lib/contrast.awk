# contrast.awk — the WCAG contrast ratio between two colours.
#
# A pure function with a command line. Given a foreground and a background it prints the
# ratio to two decimals — 1.00 for two identical colours, 21.00 for black on white — which
# is the number docs/DESIGN_TOKENS.md publishes and scripts/verify-tokens.sh re-derives
# from docs/design/tokens.css on every run.
#
# Usage:
#   awk -f scripts/lib/contrast.awk -v fg='#e9f2f6' -v bg='#12181d'
#   awk -f scripts/lib/contrast.awk -v fg='#3dd6f5' \
#       -v bg='rgba(61, 214, 245, 0.12)' -v under='#171f26'
#
# A translucent colour is not a contrast ratio on its own, so a translucent `bg` needs
# `under` — the opaque surface it is painted on — and is composited over it first. A
# translucent `fg` is composited over the resolved background the same way. Accepted
# spellings: #rgb, #rrggbb, rgb()/rgba() with comma or slash separators, channels as
# 0–255 or as percentages.
#
# The maths is WCAG 2.x: each channel is linearised (c/12.92 below the 0.03928 knee,
# ((c+0.055)/1.055)^2.4 above it), weighted 0.2126/0.7152/0.0722 into a relative
# luminance, and the ratio is (lighter + 0.05) / (darker + 0.05). The exponent is
# exp(2.4 * log(x)) rather than x^2.4 so the program holds to POSIX awk, which is the
# same dependency-free contract as the shell scripts that call it.
#
# Exit status:
#   0  the ratio was printed to stdout
#   2  a required variable is missing, or a colour could not be parsed (reason on stderr)

BEGIN {
    if (fg == "" || bg == "") {
        die("both -v fg=COLOUR and -v bg=COLOUR are required")
    }

    parse(fg, front)
    parse(bg, back)

    if (back["a"] < 1) {
        if (under == "") {
            die("bg " bg " is translucent — pass -v under=COLOUR for the surface below it")
        }
        parse(under, below)
        if (below["a"] < 1) {
            die("under " under " must be opaque")
        }
        composite(back, below, back)
    }

    if (front["a"] < 1) {
        composite(front, back, front)
    }

    lf = luminance(front)
    lb = luminance(back)
    lighter = (lf > lb) ? lf : lb
    darker = (lf > lb) ? lb : lf

    printf "%.2f\n", (lighter + 0.05) / (darker + 0.05)
}

# die MESSAGE — report an unusable input and stop. Nothing is printed to stdout, so a
# caller reading the ratio can never mistake a diagnostic for a number.
function die(message) {
    printf "contrast: %s\n", message > "/dev/stderr"
    exit 2
}

# hex_digit CHAR — the value of one hexadecimal digit, or -1 if it is not one.
function hex_digit(character,    position) {
    position = index("0123456789abcdef", tolower(character))
    return position - 1
}

# hex_pair TEXT — the value of a two-digit hexadecimal byte, or -1 if it is not one.
function hex_pair(text,    high, low) {
    high = hex_digit(substr(text, 1, 1))
    low = hex_digit(substr(text, 2, 1))
    if (high < 0 || low < 0) {
        return -1
    }
    return high * 16 + low
}

# channel TEXT — one rgb() component as 0–255, accepting a percentage.
function channel(text) {
    if (text ~ /%$/) {
        sub(/%$/, "", text)
        return (text + 0) * 255 / 100
    }
    return text + 0
}

# alpha TEXT — one rgb() alpha as 0–1, accepting a percentage.
function alpha(text) {
    if (text ~ /%$/) {
        sub(/%$/, "", text)
        return (text + 0) / 100
    }
    return text + 0
}

# parse SPEC, OUT — fill OUT with the "r", "g", "b" (0–255) and "a" (0–1) of a colour.
#
# The array is a reference, so this is how a value gets back to the caller. Anything not
# recognised is fatal rather than defaulted: a colour silently read as black would make a
# contrast check pass for the wrong reason.
function parse(spec, out,    text, body, parts, count, i) {
    text = spec
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", text)

    if (substr(text, 1, 1) == "#") {
        body = tolower(substr(text, 2))
        if (length(body) == 3) {
            body = substr(body, 1, 1) substr(body, 1, 1) \
                   substr(body, 2, 1) substr(body, 2, 1) \
                   substr(body, 3, 1) substr(body, 3, 1)
        }
        if (length(body) != 6) {
            die("not a hex colour: " spec)
        }
        out["r"] = hex_pair(substr(body, 1, 2))
        out["g"] = hex_pair(substr(body, 3, 2))
        out["b"] = hex_pair(substr(body, 5, 2))
        if (out["r"] < 0 || out["g"] < 0 || out["b"] < 0) {
            die("not a hex colour: " spec)
        }
        out["a"] = 1
        return
    }

    if (text ~ /^rgba?\(.*\)$/) {
        body = text
        sub(/^rgba?\(/, "", body)
        sub(/\)$/, "", body)
        gsub(/[,\/]/, " ", body)
        count = split(body, parts, " ")
        if (count < 3 || count > 4) {
            die("rgb() takes three channels and an optional alpha: " spec)
        }
        out["r"] = channel(parts[1])
        out["g"] = channel(parts[2])
        out["b"] = channel(parts[3])
        out["a"] = (count == 4) ? alpha(parts[4]) : 1
        for (i in out) {
            if (out[i] < 0) {
                die("negative component: " spec)
            }
        }
        if (out["a"] > 1 || out["r"] > 255 || out["g"] > 255 || out["b"] > 255) {
            die("component out of range: " spec)
        }
        return
    }

    die("unsupported colour syntax: " spec)
}

# composite TOP, BOTTOM, OUT — paint TOP over opaque BOTTOM, giving an opaque OUT.
#
# The source-over formula, per channel: top * a + bottom * (1 - a). OUT may be the same
# array as TOP, which is why every channel is read before any is written.
function composite(top, bottom, out,    a, r, g, b) {
    a = top["a"]
    r = top["r"] * a + bottom["r"] * (1 - a)
    g = top["g"] * a + bottom["g"] * (1 - a)
    b = top["b"] * a + bottom["b"] * (1 - a)
    out["r"] = r
    out["g"] = g
    out["b"] = b
    out["a"] = 1
}

# linearise VALUE — one 0–255 channel as linear-light 0–1, undoing the sRGB transfer.
function linearise(value,    c) {
    c = value / 255
    if (c <= 0.03928) {
        return c / 12.92
    }
    return exp(2.4 * log((c + 0.055) / 1.055))
}

# luminance COLOUR — the relative luminance of an opaque colour, 0–1.
function luminance(colour) {
    return 0.2126 * linearise(colour["r"]) \
         + 0.7152 * linearise(colour["g"]) \
         + 0.0722 * linearise(colour["b"])
}
