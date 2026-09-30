"""Learning facts from what the loop already wrote — the ``/v0/learn`` contract and its seam.

BF.3 (`#412 <https://github.com/NobuData/ouroboros/issues/412>`_), decision **K5**. Three
modules, split the way :mod:`ouroboros_engine.planning` is split, for the same reason:

* :mod:`~ouroboros_engine.learning.contract` is what ``ouroboros-rest`` is written against and
  is not allowed to change: a **source bundle** in, **candidates with confidence and typed
  provenance** out.
* :mod:`~ouroboros_engine.learning.extractor` is the seam — a one-method
  :class:`~ouroboros_engine.learning.extractor.Extractor` protocol — and
  :class:`~ouroboros_engine.learning.extractor.UnavailableExtractor`, what ``create_app``
  installs today: it extracts nothing and says so.

**The deterministic proposers are not here.** Correction notes, waiver reasons and remembered
steers are promoted by ``ouroboros-rest``'s proposer registry, which needs no model. This
contract is committed now so BH.1's LLM extraction
(`#423 <https://github.com/NobuData/ouroboros/issues/423>`_) — PR review cycles and run
observations — plugs into that same registry without a reshape.
"""
