"""Concrete stage executors — the only place an adapter, or a vendor SDK, is imported.

DH.3 (#1308) added the first: the Claude Agent SDK executor (``claude_agent*.py``). Code
outside this package reaches an executor through
:class:`~ouroboros_engine.execution.spi.StageExecutor`, never by importing one; ruff's
``TID251`` (``pyproject.toml``) refuses it everywhere but the composition root,
:mod:`ouroboros_engine.execution.compose`, which registers them.
"""
