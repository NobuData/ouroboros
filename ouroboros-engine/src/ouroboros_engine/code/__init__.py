"""Codebase & git mining — the engine half of the ``code`` research tool (CL.4, #617).

Mockup 22's third tool row, *⌥ Codebase & git mining — blame, bisect, dependency graph over
helios-firmware*. The research tool SPI lives in ``ouroboros-rest`` (#614), and so do the
workspace's GitHub credential and the citation contract; the repository clones live here,
with the engine's workers, because reading git history is CPU and disk work the control plane
should not do. ``ouroboros-rest``'s ``code`` adapter calls ``/v0/code/*``
(:mod:`ouroboros_engine.api.code`) and turns each answer into ``git://`` source records.

* :mod:`~ouroboros_engine.code.clones` — the clone cache: bare mirrors under
  ``OURO_ENGINE_CLONE_DIR``, one per workspace and repository, fetched with a credential that
  is handed over for one call and never written down.
* :mod:`~ouroboros_engine.code.repo` — :class:`~ouroboros_engine.code.repo.ReadOnlyRepo`, the
  only view of a clone an operation gets: lookups, never writes.
* :mod:`~ouroboros_engine.code.mining` — ``blame``, ``history``, ``changed_between`` and the
  first-parent commit list a bisect walks.
* :mod:`~ouroboros_engine.code.deps` — ``dep_graph`` for C/C++, Python and JS/TS, and an honest
  ``unsupported`` for every other stack.

Every answer names the 40-hex commit it was read at, so a ``git://repo@sha/path#L…`` locator
re-runs to the same result whatever the branch has done since.
"""
