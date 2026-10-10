"""The deep dry-run harness (CD.2, #560): real models over a virtual workspace.

See :mod:`.harness` for how a draft is walked, :mod:`.workspace` for the reads and the
overlay, :mod:`.guard` and :mod:`.tools` for the tool boundary, and :mod:`.contract` for
what goes over the wire.
"""

from .contract import DryRunEvent, DryRunRequest, DryRunResult
from .harness import DryRunHarness

__all__ = ["DryRunEvent", "DryRunHarness", "DryRunRequest", "DryRunResult"]
