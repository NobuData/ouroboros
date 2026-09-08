-- V028__github_issue_bot_authors.sql — `github_issues.author_login` accepts the logins
-- GitHub Apps actually open issues under.
--
-- Filed as part of K.4 (#102), the backlog sync — the first writer this table has ever had,
-- and therefore the first thing to discover that its author-login rule refuses a login
-- github.com issues every day.
--
-- ---------------------------------------------------------------------------
-- What was wrong, and why it was not visible until now.
-- ---------------------------------------------------------------------------
--
-- `V014` gave the column V003's `github_orgs_login_format` with the upper case left in:
--
--   ^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$   , 1..39 characters
--
-- That is exactly GitHub's rule for a **user or organisation** login, which is what V003's
-- column holds. It is not the rule for the `user.login` an *issue* comes back with. An issue
-- opened by a GitHub App carries a bot login, and a bot login is the app's slug with a
-- literal `[bot]` on the end — `dependabot[bot]`, `github-actions[bot]`,
-- `renovate[bot]` — square brackets included, because that suffix is how GitHub makes a bot
-- identity unmistakable in a namespace it shares with people.
--
-- Nothing had noticed because nothing had written a row: V014 landed the table and left it
-- empty (K.1, #99), and the fixtures in `tests/constraints.sql` are hand-written logins that
-- happen to be human ones. The sync is what turns the rule into behaviour, and the behaviour
-- would have been: **Renovate's dependency dashboard, Dependabot's alerts and every issue a
-- workflow files are silently missing from the backlog** — refused one row at a time, by a
-- CHECK, on a mirror whose acceptance criterion is *"cold import of a live repo lands all
-- open issues"*.
--
-- Fixed here rather than in the sync, and that is the decision worth recording. The two
-- alternatives available to a writer are both worse:
--
--   * **Skip the issue.** Loses a real backlog item to a property of who filed it, which is
--     the acceptance criterion inverted.
--   * **Store `null`.** The column's null means *"GitHub returned no user — the author's
--     account is gone"*, and mockup 03's panel renders that as no attribution. Writing it for
--     a bot that is very much present would make the mirror say something false, and decision
--     **K3** is that this table copies GitHub rather than editing it.
--
-- ---------------------------------------------------------------------------
-- What the rule becomes.
-- ---------------------------------------------------------------------------
--
-- The same rule with an optional `[bot]` suffix, and a bound raised by exactly its length.
-- Deliberately *not* widened to "any bracket anywhere": `[bot]` is a fixed, documented suffix,
-- and a pattern that accepted brackets in general would accept the mapping bug this
-- constraint exists to catch — a display name, or a whole `{"login": …}` object stringified
-- into the column.
--
-- 44 = GitHub's 39-character login cap plus the five characters of `[bot]`. The old bound of
-- 39 stays the bound for a human login, because the suffix is what the extra five are for.
--
-- `github_orgs.login` (V003) is deliberately left alone. That column holds an *organisation*
-- login, an organisation is never a bot, and widening it would let a workspace enable a
-- GitHub org that cannot exist.

alter table ouroboros.github_issues
  drop constraint github_issues_author_login_format,

  add constraint github_issues_author_login_format
    check (author_login is null
           or (author_login ~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*(\[bot\])?$'
               and length(author_login) between 1 and 44));

comment on column ouroboros.github_issues.author_login is
  'Who opened it, in the case GitHub returns — unfolded, because a mirrored value folded is an edit (K3). Null when the author''s account is gone. A GitHub App''s login carries a literal [bot] suffix (V028, #102), which is why the format rule is not V003''s org-login rule.';
