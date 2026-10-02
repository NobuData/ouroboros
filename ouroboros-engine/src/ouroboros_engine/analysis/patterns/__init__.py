"""BV.3's pattern analyzers (`#512 <https://github.com/NobuData/ouroboros/issues/512>`_).

Each module is one finding family — the generator of one kind of evidence line on mockup 18:

* :mod:`~ouroboros_engine.analysis.patterns.log_signature` — failure-text templates, clustered.
* :mod:`~ouroboros_engine.analysis.patterns.config_usage` — configuration options never set,
  never varied, or drifting; sampling-aware.
* :mod:`~ouroboros_engine.analysis.patterns.cache_window` — the cache going cold after a merge
  class, and whether failures cluster on those days.
* :mod:`~ouroboros_engine.analysis.patterns.queue_correlation` — a pool starved while another
  sits idle.
* :mod:`~ouroboros_engine.analysis.patterns.waiver_cite` — waivers that keep citing one gap.
* :mod:`~ouroboros_engine.analysis.patterns.workflow_outcome` — stage-outcome correlations
  (minimum-support gated) and unique-failure attribution across stages.
"""
