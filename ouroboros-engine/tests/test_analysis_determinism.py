"""The determinism discipline — what registration refuses in an analyzer's source (#511)."""

from typing import ClassVar

import pytest

from analysis_fakes import RaisesAnalyzer, ledger_for
from ouroboros_engine.analysis.determinism import check_class, violations
from ouroboros_engine.analysis.registry import (
    AnalyzerRegistry,
    RegistrationError,
    default_registry,
)
from ouroboros_engine.analysis.spi import Analyzer


def test_every_registered_analyzer_is_clean() -> None:
    for entry in default_registry():
        assert check_class(entry.cls) == [], entry.path


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("import time\nx = time.time()", "calls time.time()"),
        ("import time\nx = time.perf_counter_ns()", "calls time.perf_counter_ns()"),
        (
            "from datetime import datetime\nx = datetime.now()",
            "reads the clock with datetime.now()",
        ),
        (
            "import datetime\nx = datetime.date.today()",
            "reads the clock with datetime.date.today()",
        ),
        (
            "import pandas as pd\nx = pd.Timestamp.utcnow()",
            "reads the clock with pd.Timestamp.utcnow()",
        ),
        ("import uuid\nx = uuid.uuid4()", "calls uuid.uuid4()"),
        ("import os\nx = os.urandom(8)", "calls os.urandom()"),
        ("import secrets", "imports secrets"),
        ("from secrets import token_hex", "imports secrets"),
        ("from time import time", "imports time.time"),
        ("from uuid import uuid4", "imports uuid.uuid4"),
        ("import random\nr = random.SystemRandom()", "calls random.SystemRandom()"),
        (
            "import numpy as np\ng = np.random.default_rng()",
            "builds an unseeded generator",
        ),
    ],
)
def test_clock_and_entropy_reads_are_found(source: str, expected: str) -> None:
    (found,) = violations(source)
    assert found.startswith("line ") and expected in found


@pytest.mark.parametrize(
    "source",
    [
        "import numpy as np\ng = np.random.default_rng(20260809)",
        "import numpy as np\ng = np.random.default_rng(seed=1)",
        "import time\ntime.sleep(0)",
        "from datetime import date\nx = date(2026, 6, 22)",
        "x = window.to",
        "import random\nx = random.random()",
    ],
)
def test_deterministic_code_passes(source: str) -> None:
    assert violations(source) == []


class Clocked(Analyzer):
    """Reads the wall clock — refused at registration."""

    id = "fake_clocked"
    version = 1
    requires = RaisesAnalyzer.requires
    parameters: ClassVar[dict[str, object]] = {}

    def analyze(self, corpus: object) -> list[object]:
        """Stamp the findings with the time.

        Args:
            corpus: Ignored.

        Returns:
            Nothing.
        """
        import datetime

        del corpus
        _ = datetime.datetime.now()
        return []


def test_registration_refuses_an_analyzer_that_reads_the_clock() -> None:
    registry = AnalyzerRegistry(ledger_for(Clocked))
    with pytest.raises(
        RegistrationError, match=r"determinism discipline.*datetime\.datetime\.now"
    ):
        registry.register(f"{__name__}:Clocked")
