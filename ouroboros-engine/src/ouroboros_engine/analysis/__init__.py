"""The Build Analyzer's engine side — the analyzer SPI and its statistical core (#511, BV.2).

* :mod:`~ouroboros_engine.analysis.contract` — the corpus an analyzer reads and the findings it
  writes (BU.2's ``analysis_findings`` row, mirrored), and their one canonical serialization.
* :mod:`~ouroboros_engine.analysis.spi` — the ``Analyzer`` base class and its determinism
  discipline.
* :mod:`~ouroboros_engine.analysis.ledger` — every analyzer version's parameters, pinned.
* :mod:`~ouroboros_engine.analysis.registry` — discovery and registration.
* :mod:`~ouroboros_engine.analysis.harness` — runs a registry over a corpus: one sandbox per
  analyzer, budgets, failure isolation.
* :mod:`~ouroboros_engine.analysis.sandbox` — the process an analyzer runs in: no network, no
  subprocess, a memory limit, fixed seeds.
* :mod:`~ouroboros_engine.analysis.changepoint` — the first analyzer: PELT over daily median
  build durations, with ranked attribution.

Nothing here is served over HTTP yet: corpus assembly and the run orchestration that calls the
harness are BV.1 (`#510 <https://github.com/NobuData/ouroboros/issues/510>`_).
"""
