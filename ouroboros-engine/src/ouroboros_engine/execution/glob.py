"""The path glob grammar the tool policy matches with — AP.3's, written in Python.

The tool policy (:mod:`~ouroboros_engine.execution.policy`) refuses a write *before* it runs
for the same two reasons AP.3's guardrails
(`#305 <https://github.com/NobuData/ouroboros/issues/305>`_) fail a change-set *after* it is
reported: the path is protected, or it is CI configuration the stage may not touch. The two
seats must agree on what a pattern means, so this module is ``ouroboros-rest``'s
``guardrails.glob.ts`` and the CI registry beside it, transcribed rather than reinvented::

    **   any number of whole segments, including none   drivers/**      ⊨ drivers/can/a.c
    *    any run of characters within one segment         *.yml           ⊨ ci.yml
    ?    exactly one character within one segment         ci-?.yml        ⊨ ci-1.yml

Everything else is literal, and matching is case-sensitive. ``tests/test_execution_glob.py``
reads the TypeScript registry and fails when :data:`CI_CONFIG_GLOBS` has drifted from it.
"""

import re
from collections.abc import Iterable
from functools import lru_cache
from typing import Final

#: The CI registry's version — ``guardrails.ci.ts``'s ``CI_REGISTRY_VERSION``.
CI_REGISTRY_VERSION: Final = "ci-v1"

#: Where CI systems keep their configuration — ``guardrails.ci.ts``'s ``CI_CONFIG_GLOBS``,
#: in its order. A write to one of these needs the stage's ``touch_ci`` permission.
CI_CONFIG_GLOBS: Final[tuple[str, ...]] = (
    ".github/workflows/**",
    ".github/actions/**",
    ".gitlab-ci.yml",
    ".gitlab-ci.yaml",
    ".gitlab/ci/**",
    "**/Jenkinsfile",
    "jenkins/**",
    ".circleci/**",
    ".travis.yml",
    "azure-pipelines.yml",
    "azure-pipelines.yaml",
    ".azure-pipelines/**",
    "bitbucket-pipelines.yml",
    ".buildkite/**",
    ".drone.yml",
    ".drone.yaml",
    "appveyor.yml",
    ".appveyor.yml",
    ".woodpecker.yml",
    ".woodpecker.yaml",
    ".woodpecker/**",
    "cloudbuild.yml",
    "cloudbuild.yaml",
    "buildspec.yml",
    "buildspec.yaml",
    ".tekton/**",
    ".semaphore/**",
    "codefresh.yml",
    "ci/pipeline.yml",
    ".github/dependabot.yml",
    "renovate.json",
    ".github/renovate.json",
    ".pre-commit-config.yaml",
)


@lru_cache(maxsize=512)
def glob_to_regex(glob: str) -> re.Pattern[str]:
    """Compile a glob into an anchored regular expression.

    Args:
        glob: The pattern, in the grammar above.

    Returns:
        A pattern matching whole paths only. A ``**/`` segment consumes its trailing slash,
        so ``drivers/**`` matches ``drivers/a.c`` and ``a/**/b`` matches ``a/b``.
    """
    pattern = ""
    index = 0
    while index < len(glob):
        char = glob[index]
        if char == "*" and glob[index + 1 : index + 2] == "*":
            if glob[index + 2 : index + 3] == "/":
                pattern += "(?:[^/]+/)*"
                index += 3
            else:
                pattern += ".*"
                index += 2
            continue
        if char == "*":
            pattern += "[^/]*"
        elif char == "?":
            pattern += "[^/]"
        else:
            pattern += re.escape(char)
        index += 1
    return re.compile(f"^{pattern}$", re.DOTALL)


def first_match(path: str, globs: Iterable[str]) -> str | None:
    """The first glob, in the order given, that matches a path.

    Args:
        path: A working-tree-relative path with forward slashes.
        globs: The patterns.

    Returns:
        The glob that admitted the path, or ``None`` when none does.
    """
    for glob in globs:
        if glob_to_regex(glob).match(path):
            return glob
    return None
