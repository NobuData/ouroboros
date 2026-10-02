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
* :mod:`~ouroboros_engine.analysis.common` — the helpers every analyzer shares.
* :mod:`~ouroboros_engine.analysis.changepoint` — the first analyzer: PELT over daily median
  build durations, with ranked attribution.
* :mod:`~ouroboros_engine.analysis.patterns` — BV.3's pattern analyzers (#512): log
  signatures, config usage, cache windows, queue correlation, waiver cites, workflow outcomes.

:mod:`ouroboros_engine.api.analysis` serves the harness to BV.1's run orchestrator in
``ouroboros-rest`` (`#510 <https://github.com/NobuData/ouroboros/issues/510>`_), which assembles
the corpus.
"""
