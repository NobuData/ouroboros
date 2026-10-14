"""Stage execution — the StageExecutor SPI, its event vocabulary and its tool policy (DH.1).

This package is the interface core engine code may import. Concrete executors live in
:mod:`ouroboros_engine.execution.executors`, which nothing outside it may import (ruff
``TID251``); see ``docs/STAGE_EXECUTORS.md``.
"""
