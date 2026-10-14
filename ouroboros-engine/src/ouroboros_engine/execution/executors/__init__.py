"""Concrete stage executors — the only place an adapter, or a vendor SDK, is imported.

Empty until DH.3 (#1308) adds the Claude Agent SDK executor. Code outside this package
reaches an executor through :class:`~ouroboros_engine.execution.spi.StageExecutor`, never by
importing one; ruff's ``TID251`` (``pyproject.toml``) refuses it.
"""
