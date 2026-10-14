"""The glob grammar, and the CI registry's parity with ouroboros-rest's."""

import re
from pathlib import Path

import pytest

from ouroboros_engine.execution.glob import (
    CI_CONFIG_GLOBS,
    CI_REGISTRY_VERSION,
    first_match,
    glob_to_regex,
)

REST_CI = (
    Path(__file__).resolve().parents[2]
    / "ouroboros-rest/src/modules/guardrails/guardrails.ci.ts"
)


@pytest.mark.parametrize(
    ("glob", "path", "matches"),
    [
        ("drivers/**", "drivers/a.c", True),
        ("drivers/**", "drivers/can/a.c", True),
        ("drivers/**", "driver/a.c", False),
        ("a/**/b", "a/b", True),
        ("a/**/b", "a/x/y/b", True),
        ("**/Jenkinsfile", "Jenkinsfile", True),
        ("**/Jenkinsfile", "svc/Jenkinsfile", True),
        ("**/Jenkinsfile", "jenkinsfile", False),
        ("*.yml", "ci.yml", True),
        ("*.yml", "a/ci.yml", False),
        ("ci-?.yml", "ci-1.yml", True),
        ("ci-?.yml", "ci-10.yml", False),
        (".gitlab-ci.yml", ".gitlab-ciXyml", False),
        ("a+b(c)", "a+b(c)", True),
    ],
)
def test_the_grammar(glob: str, path: str, matches: bool) -> None:
    assert bool(glob_to_regex(glob).match(path)) is matches


def test_first_match_keeps_the_given_order() -> None:
    assert first_match("boot/a.s", ["src/**", "boot/**", "**"]) == "boot/**"
    assert first_match("x", []) is None


@pytest.mark.skipif(
    not REST_CI.exists(), reason="ouroboros-rest is not beside this module"
)
def test_the_ci_registry_matches_ouroboros_rest() -> None:
    source = REST_CI.read_text()
    block = source.split("export const CI_CONFIG_GLOBS", 1)[1].split("];", 1)[0]
    assert tuple(re.findall(r'^\s*"([^"]+)",', block, re.MULTILINE)) == CI_CONFIG_GLOBS
    assert f'CI_REGISTRY_VERSION = "{CI_REGISTRY_VERSION}"' in source
