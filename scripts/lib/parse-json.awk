# parse-json.awk — flatten a JSON or JSONC document into greppable records.
#
# Written for turbo.json, which is JSON *with comments*: the file explains itself, and
# those explanations name the very keys a check wants to assert on. A grep over the raw
# file cannot tell the configuration from the paragraph about it — `"cache": false` in a
# comment satisfies a naive check exactly as well as the real setting does — so the
# comments are removed before anything is asserted. package.json has no comments, and
# stripping none is a no-op, so one parser serves both files.
#
# Output is one record per key, `<scope><TAB><key><TAB><value>`, for the two levels of
# nesting the repo's configuration actually uses:
#
#   root<TAB>KEY<TAB>VALUE        a top-level key
#   PARENT<TAB>KEY<TAB>VALUE      a key one level inside the top-level object PARENT
#
# so turbo.json's task graph reads as `tasks<TAB>build<TAB>{ ... }` and package.json's
# verbs as `scripts<TAB>build<TAB>"turbo run build"`. Values are reproduced verbatim
# except that whitespace outside strings is collapsed to single spaces, which is what
# lets a multi-line object be matched by one pattern.
#
# Keys are recognised only outside arrays, so an object inside an array — which this
# repository has none of, and which has no meaningful two-level name — contributes no
# record rather than a misleading one.
#
# Usage:
#   awk -f scripts/lib/parse-json.awk turbo.json
#
# Exit status:
#   0  the document parsed
#   1  it did not: an unterminated string, or braces that do not balance

{ src = src $0 "\n" }

# string_end(S, START) — index of the quote closing the string literal that opens at
# START, or 0 if it is never closed. Backslash escapes are honoured, so an escaped quote
# inside the literal does not end it.
function string_end(s, start,   i, n, c) {
  n = length(s)
  for (i = start + 1; i <= n; i++) {
    c = substr(s, i, 1)
    if (c == "\\") { i++; continue }
    if (c == "\"") return i
  }
  return 0
}

# skip_ws(S, START) — index of the first character at or after START that is not
# whitespace.
function skip_ws(s, start,   i, n, c) {
  n = length(s)
  for (i = start; i <= n; i++) {
    c = substr(s, i, 1)
    if (c != " " && c != "\t" && c != "\n" && c != "\r") return i
  }
  return n + 1
}

# strip_comments(S) — S with its `//` and `/* */` comments removed.
#
# The scan is character by character and string-aware, because the one place a `//` in
# this repository's configuration is not a comment is inside a string: turbo.json opens
# with a `$schema` URL, and a line-oriented strip would cut the document in half at it.
# Sets `malformed` when the document ends inside a string literal.
function strip_comments(s,   i, n, c, d, out, instr) {
  n = length(s)
  out = ""
  for (i = 1; i <= n; i++) {
    c = substr(s, i, 1)
    if (instr) {
      out = out c
      if (c == "\\") { out = out substr(s, i + 1, 1); i++; continue }
      if (c == "\"") instr = 0
      continue
    }
    if (c == "\"") { instr = 1; out = out c; continue }
    if (c == "/") {
      d = substr(s, i + 1, 1)
      # A line comment is replaced by the newline that ended it, so line structure —
      # and therefore anything downstream that counts lines — survives.
      if (d == "/") {
        while (i <= n && substr(s, i, 1) != "\n") i++
        out = out "\n"
        continue
      }
      if (d == "*") {
        i += 2
        while (i < n && !(substr(s, i, 1) == "*" && substr(s, i + 1, 1) == "/")) i++
        i++
        continue
      }
    }
    out = out c
  }
  if (instr) malformed = 1
  return out
}

# value_end(S, START) — index of the last character of the value beginning at START, or
# 0 if it is unterminated. Objects and arrays are matched to their closing bracket;
# strings to their closing quote; a scalar runs to the comma or bracket that ends it.
function value_end(s, start,   i, n, c, opener, closer, depth, term) {
  n = length(s)
  c = substr(s, start, 1)
  if (c == "\"") return string_end(s, start)
  if (c == "{" || c == "[") {
    opener = c
    closer = (c == "{") ? "}" : "]"
    depth = 0
    for (i = start; i <= n; i++) {
      c = substr(s, i, 1)
      if (c == "\"") {
        i = string_end(s, i)
        if (i == 0) return 0
        continue
      }
      if (c == opener) depth++
      else if (c == closer) {
        depth--
        if (depth == 0) return i
      }
    }
    return 0
  }
  for (i = start; i <= n; i++) {
    term = substr(s, i, 1)
    if (term == "," || term == "}" || term == "]") break
  }
  # Back off the terminator and any whitespace before it.
  i--
  while (i >= start) {
    term = substr(s, i, 1)
    if (term != " " && term != "\t" && term != "\n" && term != "\r") break
    i--
  }
  return (i >= start) ? i : 0
}

# flatten(T) — T with every run of whitespace outside a string replaced by one space,
# and no leading or trailing space. What a record has to preserve is the value's
# content, not the line breaks its author chose.
function flatten(t,   i, n, c, out, instr, space) {
  n = length(t)
  out = ""
  for (i = 1; i <= n; i++) {
    c = substr(t, i, 1)
    if (instr) {
      out = out c
      if (c == "\\") { out = out substr(t, i + 1, 1); i++; continue }
      if (c == "\"") instr = 0
      continue
    }
    if (c == "\"") { instr = 1; space = 0; out = out c; continue }
    if (c == " " || c == "\t" || c == "\n" || c == "\r") {
      if (!space && out != "") out = out " "
      space = 1
      continue
    }
    space = 0
    out = out c
  }
  sub(/ $/, "", out)
  return out
}

END {
  doc = strip_comments(src)
  if (malformed) {
    printf "parse-json: unterminated string\n" > "/dev/stderr"
    exit 1
  }

  n = length(doc)
  odepth = 0
  adepth = 0
  topkey = ""

  for (i = 1; i <= n; i++) {
    c = substr(doc, i, 1)

    if (c == "\"") {
      end = string_end(doc, i)
      if (end == 0) {
        printf "parse-json: unterminated string\n" > "/dev/stderr"
        exit 1
      }
      key = substr(doc, i + 1, end - i - 1)
      # A string is a key only when a colon follows it, and only outside an array:
      # inside one it is an element, and an element has no name to record.
      after = skip_ws(doc, end + 1)
      if (substr(doc, after, 1) == ":" && adepth == 0 && (odepth == 1 || odepth == 2)) {
        vstart = skip_ws(doc, after + 1)
        vend = value_end(doc, vstart)
        if (vend == 0) {
          printf "parse-json: unterminated value for key %s\n", key > "/dev/stderr"
          exit 1
        }
        value = flatten(substr(doc, vstart, vend - vstart + 1))
        if (odepth == 1) {
          printf "root\t%s\t%s\n", key, value
          # Set after printing, so the parent recorded for the keys inside this value is
          # this key rather than the one before it.
          topkey = key
        } else {
          printf "%s\t%s\t%s\n", topkey, key, value
        }
      }
      i = end
      continue
    }

    if (c == "{") odepth++
    else if (c == "}") odepth--
    else if (c == "[") adepth++
    else if (c == "]") adepth--

    if (odepth < 0 || adepth < 0) {
      printf "parse-json: unbalanced brackets\n" > "/dev/stderr"
      exit 1
    }
  }

  if (odepth != 0 || adepth != 0) {
    printf "parse-json: unbalanced brackets\n" > "/dev/stderr"
    exit 1
  }
}
