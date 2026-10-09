"""``/v0/code/*`` — the codebase & git mining tool's engine half (CL.4, #617).

``ouroboros-rest``'s ``code`` research adapter calls these with a repository, a ref and, for
that call only, the workspace's GitHub token; each answer names the commit it was read at, from
which the adapter builds a ``git://owner/name@sha/path#Lnn`` citation:

* ``POST /v0/code/blame`` — who last changed a line range, and *"unchanged in 14 months"*.
* ``POST /v0/code/history`` — change frequency and churn of a path or a symbol over a window.
* ``POST /v0/code/changed-between`` — what moved between a baseline and a later commit.
* ``POST /v0/code/dep-graph`` — a module's dependency graph, or ``status: unsupported``.
* ``POST /v0/code/bisect-commits`` — the first-parent line a bisect walks. The bisect itself
  is orchestrated by ``ouroboros-rest`` (farm jobs, checkpoints); this answers the candidates.

Handlers are plain functions on purpose: Starlette runs them in its thread pool, so a first
clone that takes a minute holds a worker thread, never the event loop.

Failures answer in the error envelope with a ``code_*`` code — ``404 code_ref_not_found`` /
``code_path_not_found``, ``409 code_not_ancestor``, ``422 code_remote_refused`` /
``code_range_outside_file`` / ``code_range_too_wide`` / ``code_bisect_too_long``, and
``502 code_remote_auth`` / ``code_remote_unreachable`` when the clone could not be fetched.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ouroboros_engine.api.v0 import V0_PREFIX, V0_TAG
from ouroboros_engine.code.clones import (
    CloneStore,
    OpenedClone,
    RemoteAuthError,
    RemoteRefusedError,
    RemoteUnreachableError,
    RepositoryRef,
)
from ouroboros_engine.code.contract import (
    BisectCommits,
    BisectCommitsRequest,
    Blame,
    BlameRequest,
    ChangedBetween,
    ChangedBetweenRequest,
    CloneInfo,
    CodeRepository,
    DepGraph,
    DepGraphRequest,
    History,
    HistoryRequest,
)
from ouroboros_engine.code.deps import dep_graph
from ouroboros_engine.code.mining import (
    BisectTooLongError,
    NotAncestorError,
    RangeOutsideFileError,
    RangeTooWideError,
    bisect_commits,
    blame,
    changed_between,
    history,
)
from ouroboros_engine.code.repo import PathNotFoundError, RefNotFoundError
from ouroboros_engine.core.errors import envelope

#: Where each operation is served, under ``/v0``.
BLAME_ROUTE = "/code/blame"
HISTORY_ROUTE = "/code/history"
CHANGED_BETWEEN_ROUTE = "/code/changed-between"
DEP_GRAPH_ROUTE = "/code/dep-graph"
BISECT_COMMITS_ROUTE = "/code/bisect-commits"

#: What a caller reads when the clone could not be fetched — a constant, like every ``5xx``
#: message this service sends.
FETCH_FAILED_MESSAGE = "The repository could not be fetched."

router = APIRouter(prefix=V0_PREFIX, tags=[V0_TAG])


def _store(request: Request) -> CloneStore:
    """The clone cache installed on the application.

    Args:
        request: The incoming request.

    Returns:
        ``app.state.code_clones`` — a test installs its own.
    """
    return request.app.state.code_clones


def _read[Answer: BaseModel](
    request: Request,
    repository: CodeRepository,
    operation: Callable[[OpenedClone, CloneInfo], Answer],
) -> Answer | JSONResponse:
    """Open the clone, run an operation, and answer a failure in the envelope.

    A ref the clone does not know yet forces one fetch and one retry before it is a ``404``
    — a branch pushed a minute ago is not "not found".

    Args:
        request: The incoming request.
        repository: The repository and this call's credential.
        operation: The read.

    Returns:
        The operation's answer, or the failure's envelope.
    """
    store = _store(request)
    ref = RepositoryRef(
        workspace=repository.workspace,
        slug=repository.slug,
        remote=repository.remote,
        token=repository.token,
    )
    try:
        opened = store.open(ref)
        try:
            return _once(opened, repository, operation)
        except RefNotFoundError:
            if opened.fetched:
                raise
            return _once(store.open(ref, force=True), repository, operation)
    except RemoteRefusedError as error:
        return _fail(422, "code_remote_refused", str(error))
    except RemoteAuthError:
        return _fail(502, "code_remote_auth", FETCH_FAILED_MESSAGE)
    except RemoteUnreachableError:
        return _fail(502, "code_remote_unreachable", FETCH_FAILED_MESSAGE)
    except RefNotFoundError as error:
        return _fail(
            404,
            "code_ref_not_found",
            f"The ref {error.ref} {error.reason}.",
            {"ref": error.ref},
        )
    except PathNotFoundError as error:
        return _fail(
            404,
            "code_path_not_found",
            f"There is no {error.kind} {error.path} at {error.sha[:12]}.",
            {"path": error.path, "sha": error.sha},
        )
    except RangeOutsideFileError as error:
        return _fail(
            422,
            "code_range_outside_file",
            str(error),
            {"path": error.path, "start": error.start, "length": error.length},
        )
    except RangeTooWideError as error:
        return _fail(422, "code_range_too_wide", str(error))
    except BisectTooLongError as error:
        return _fail(422, "code_bisect_too_long", str(error))
    except NotAncestorError as error:
        return _fail(409, "code_not_ancestor", str(error))


def _once[Answer: BaseModel](
    opened: OpenedClone,
    repository: CodeRepository,
    operation: Callable[[OpenedClone, CloneInfo], Answer],
) -> Answer:
    """Run an operation over an opened clone and close it.

    Args:
        opened: The clone.
        repository: The request's repository.
        operation: The read.

    Returns:
        The operation's answer.
    """
    try:
        return operation(opened, _clone_info(repository, opened))
    finally:
        opened.repo.close()


def _clone_info(repository: CodeRepository, opened: OpenedClone) -> CloneInfo:
    """The clone an answer was read from.

    Args:
        repository: The request's repository.
        opened: The opened clone.

    Returns:
        Its :class:`CloneInfo`.
    """
    return CloneInfo(
        repository=repository.slug,
        fetched_at=datetime.fromtimestamp(opened.fetched_at, tz=UTC),
        stale=opened.stale,
    )


def _fail(
    status: int, code: str, message: str, details: dict[str, Any] | None = None
) -> JSONResponse:
    """A failure in the envelope.

    Args:
        status: The HTTP status.
        code: The ``code_*`` code.
        message: The sentence — a constant or one built from the caller's own input.
        details: What is specific to it.

    Returns:
        The response.
    """
    return JSONResponse(status_code=status, content=envelope(code, message, details))


@router.post(BLAME_ROUTE, summary="Who last changed a line range", response_model=Blame)
def blame_route(request: Request, payload: BlameRequest) -> Blame | JSONResponse:
    """Blame a line range at a ref.

    Args:
        request: The incoming request.
        payload: The repository, ref, path and range.

    Returns:
        The hunks, the last change, and how long the range had gone unchanged.
    """
    return _read(
        request,
        payload.repository,
        lambda opened, clone: blame(
            opened.repo, clone, payload.ref, payload.path, payload.start, payload.end
        ),
    )


@router.post(
    HISTORY_ROUTE,
    summary="Change frequency and churn over a window",
    response_model=History,
)
def history_route(request: Request, payload: HistoryRequest) -> History | JSONResponse:
    """Trace a path or a symbol over a window.

    Args:
        request: The incoming request.
        payload: The repository, ref, path or symbol, and window.

    Returns:
        The changes and their churn.
    """
    return _read(
        request,
        payload.repository,
        lambda opened, clone: history(
            opened.repo,
            clone,
            payload.ref,
            path=payload.path,
            symbol=payload.symbol,
            window_days=payload.window_days,
        ),
    )


@router.post(
    CHANGED_BETWEEN_ROUTE,
    summary="What moved between two commits",
    response_model=ChangedBetween,
)
def changed_between_route(
    request: Request, payload: ChangedBetweenRequest
) -> ChangedBetween | JSONResponse:
    """List what moved between a baseline and a later ref.

    Args:
        request: The incoming request.
        payload: The repository, the two refs and the scope.

    Returns:
        The commits and files.
    """
    return _read(
        request,
        payload.repository,
        lambda opened, clone: changed_between(
            opened.repo, clone, payload.base, payload.head, payload.scope
        ),
    )


@router.post(
    DEP_GRAPH_ROUTE, summary="A module's dependency graph", response_model=DepGraph
)
def dep_graph_route(
    request: Request, payload: DepGraphRequest
) -> DepGraph | JSONResponse:
    """Graph a module's dependencies, or say the stack is unsupported.

    Args:
        request: The incoming request.
        payload: The repository, ref, module and stack.

    Returns:
        The graph, or ``status: unsupported`` with the reason.
    """
    return _read(
        request,
        payload.repository,
        lambda opened, clone: dep_graph(
            opened.repo, clone, payload.ref, payload.module, payload.stack
        ),
    )


@router.post(
    BISECT_COMMITS_ROUTE,
    summary="The commits a bisect between two refs walks",
    response_model=BisectCommits,
)
def bisect_commits_route(
    request: Request, payload: BisectCommitsRequest
) -> BisectCommits | JSONResponse:
    """List a bisect's candidates.

    Args:
        request: The incoming request.
        payload: The repository and the good and bad refs.

    Returns:
        The first-parent line and its step bound.
    """
    return _read(
        request,
        payload.repository,
        lambda opened, clone: bisect_commits(
            opened.repo, clone, payload.good, payload.bad
        ),
    )
