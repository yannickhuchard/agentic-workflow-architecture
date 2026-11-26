"""
A throwaway PostgreSQL for the tests of the shared runtime store (specification 29).

With AWA_TEST_POSTGRES_URL set (as in CI, where a postgres service runs), the
tests use that server and create a database of their own in it. Otherwise they
start a cluster of their own in a temporary directory with initdb and pg_ctl,
on a free port, and stop it at the end. Where PostgreSQL or psycopg is missing,
postgres_unavailable() says why and the tests are skipped.
"""

import glob
import os
import shutil
import socket
import subprocess
import tempfile
import time
from urllib.parse import urlsplit, urlunsplit


def _binaries() -> str | None:
    candidates = [os.environ.get("AWA_TEST_POSTGRES_BIN"), *sorted(glob.glob("/usr/lib/postgresql/*/bin"), reverse=True)]
    for directory in candidates:
        if directory and os.path.exists(os.path.join(directory, "initdb")):
            return directory
    found = shutil.which("initdb")
    return os.path.dirname(found) if found else None


def _as_root() -> bool:
    return hasattr(os, "getuid") and os.getuid() == 0


def _has_postgres_user() -> bool:
    return subprocess.run(["id", "postgres"], capture_output=True, check=False).returncode == 0


def postgres_unavailable() -> str | None:
    """Why the tests cannot have a PostgreSQL, or None when they can"""
    try:
        import psycopg  # noqa: F401
    except ImportError:
        return 'psycopg is not installed (pip install "agentic-workflow-architecture[postgres]")'
    if os.environ.get("AWA_TEST_POSTGRES_URL"):
        return None
    if not _binaries():
        return "PostgreSQL is not installed (no initdb found; set AWA_TEST_POSTGRES_URL or AWA_TEST_POSTGRES_BIN)"
    if _as_root() and not _has_postgres_user():
        return 'running as root without a "postgres" user to run initdb as'
    return None


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class TestPostgres:
    """A PostgreSQL server that gives each test a database of its own"""

    __test__ = False  # not a test class

    def __init__(self) -> None:
        self._counter = 0
        self._directory: str | None = None
        external = os.environ.get("AWA_TEST_POSTGRES_URL")
        if external:
            self.admin = external
            return
        binaries = _binaries()
        assert binaries, postgres_unavailable()
        prefix = ["runuser", "-u", "postgres", "--"] if _as_root() else []
        self._run = lambda program, *args: subprocess.run([*prefix, os.path.join(binaries, program), *args], check=True, capture_output=True)
        self._directory = tempfile.mkdtemp(prefix="awa-pg-")
        if _as_root():
            os.chmod(self._directory, 0o755)
            shutil.chown(self._directory, "postgres")
        self._data = os.path.join(self._directory, "data")
        port = _free_port()
        self._run("initdb", "-D", self._data, "-A", "trust", "-U", "awa", "-E", "UTF8", "--no-locale", "--no-sync")
        self._run("pg_ctl", "-D", self._data, "-l", os.path.join(self._directory, "log"), "-w", "-o",
                  f"-p {port} -k {self._directory} -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=300", "start")
        self.admin = f"postgres://awa@127.0.0.1:{port}/postgres"

    def database(self) -> str:
        """A new, empty database, as a URL"""
        import psycopg
        self._counter += 1
        name = f"awa_test_{os.getpid()}_{int(time.time() * 1000)}_{self._counter}"
        with psycopg.connect(self.admin, autocommit=True) as connection:
            connection.execute(f"CREATE DATABASE {name}")
        parts = urlsplit(self.admin)
        return urlunsplit((parts.scheme, parts.netloc, f"/{name}", parts.query, parts.fragment))

    def stop(self) -> None:
        if self._directory:
            try:
                self._run("pg_ctl", "-D", self._data, "-m", "immediate", "stop")
            except subprocess.CalledProcessError:
                pass
            shutil.rmtree(self._directory, ignore_errors=True)
            self._directory = None
