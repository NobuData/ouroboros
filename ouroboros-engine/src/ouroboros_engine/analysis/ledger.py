r"""Every analyzer version's parameters, pinned (#511).

A key is ``<analyzer id>@v<version>``; a value is the sha256 of that version's ``parameters``
in canonical JSON (:func:`ouroboros_engine.analysis.spi.parameters_fingerprint`). The registry
refuses an analyzer whose fingerprint is not the one pinned for its version, so:

* **retuning without a version bump fails** — the fingerprint no longer matches;
* **bumping the version means adding a line here** — an unpinned version is refused too;
* **an entry is never edited or removed** — a finding stored as ``change_point@v1`` must stay
  explainable by v1's parameters. Add the next version beside it.

To pin a new version, run::

    uv run python -c "from ouroboros_engine.analysis.changepoint import PARAMETERS; \\
        from ouroboros_engine.analysis.spi import parameters_fingerprint; \\
        print(parameters_fingerprint(PARAMETERS))"
"""

#: ``<id>@v<version>`` → sha256 of its parameters' canonical JSON.
PARAMETER_LEDGER: dict[str, str] = {
    "change_point@v1": "9c9c9eff7f709047d76aa582dbfb5143e31485c2c324eb84263f926df8773fc4",
}
