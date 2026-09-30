"""The seam an extractor plugs into, and the one installed today.

BF.3 (`#412 <https://github.com/NobuData/ouroboros/issues/412>`_). The contract beside this
module must not change; *this* is the part that is meant to. Two extractors are foreseen:

* :class:`UnavailableExtractor` — installed today. It extracts nothing and says so in
  ``notes``, because the deterministic proposers run in ``ouroboros-rest`` and need no model,
  and an answer that looked like extraction without a model behind it would be the
  overclaiming decision **K5** rules out.
* BH.1's LLM extractor (`#423 <https://github.com/NobuData/ouroboros/issues/423>`_) — PR
  review cycles and run observations, behind the invocation gateway. It answers **this**
  contract; what changes is one line in :func:`ouroboros_engine.main.create_app` and the
  value of :attr:`~ouroboros_engine.learning.contract.Learned.extractor`.
"""

from typing import Protocol, runtime_checkable

from ouroboros_engine.learning.contract import Learned, LearnRequest

#: What the installed extractor calls itself — decision **K10**'s provenance.
UNAVAILABLE_EXTRACTOR = "unavailable-v0"

#: Why it extracted nothing — rendered to an operator, never to a reviewer.
UNAVAILABLE_NOTE = (
    "No model-backed extractor is installed; LLM extraction arrives with #423 (BH.1). "
    "Correction notes, waiver reasons and remembered steers are proposed deterministically "
    "by ouroboros-rest."
)


@runtime_checkable
class Extractor(Protocol):
    """What ``POST /v0/learn`` calls to get candidates."""

    def extract(self, request: LearnRequest) -> Learned:
        """Learn candidate facts from a source bundle.

        Args:
            request: The validated bundle.

        Returns:
            The candidates, what produced them, and any notes.
        """
        ...


class UnavailableExtractor:
    """The extractor installed until BH.1: nothing extracted, and the reason stated."""

    def extract(self, request: LearnRequest) -> Learned:
        """Answer honestly that nothing was extracted.

        Args:
            request: The validated bundle — read for nothing, and logged by the route only
                as counts.

        Returns:
            No candidates, ``unavailable-v0``, and the note saying why.
        """
        del request
        return Learned(
            candidates=[], extractor=UNAVAILABLE_EXTRACTOR, notes=[UNAVAILABLE_NOTE]
        )
