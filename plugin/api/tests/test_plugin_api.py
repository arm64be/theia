import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from api.plugin_api import (  # noqa: E402
    _extract_host,
    _format_host_for_url,
    _validate_port,
)


class TestValidatePort:
    @pytest.mark.parametrize(
        ("port", "expected"),
        [
            (1024, 1024),
            (65535, 65535),
            ("5173", 5173),
            ("8080", 8080),
        ],
    )
    def test_valid_ports(self, port, expected):
        assert _validate_port(port) == expected

    @pytest.mark.parametrize(
        ("port", "match"),
        [
            (1023, "reserved"),
            (80, "reserved"),
            (65536, "out of range"),
            (99999, "out of range"),
            (9119, "blocked"),
        ],
    )
    def test_invalid_ports(self, port, match):
        with pytest.raises(ValueError, match=match):
            _validate_port(port)

    @pytest.mark.parametrize(
        "port",
        ["not-a-number", "", None],
    )
    def test_unparseable_ports(self, port):
        with pytest.raises(ValueError, match="Invalid port"):
            _validate_port(port)


class TestExtractHost:
    @pytest.mark.parametrize(
        ("host", "expected"),
        [
            ("localhost", "localhost"),
            ("127.0.0.1", "127.0.0.1"),
            ("127.0.0.1:5173", "127.0.0.1"),
            ("[::1]", "::1"),
            ("[::1]:5173", "::1"),
            ("::1", "::1"),
            ("2001:db8::1", "2001:db8::1"),
            ("", "localhost"),
            ("   ", "localhost"),
            ("0.0.0.0", "0.0.0.0"),
            ("example.com:8080", "example.com"),
        ],
    )
    def test_extract_host(self, host, expected):
        assert _extract_host(host) == expected


class TestFormatHostForUrl:
    @pytest.mark.parametrize(
        ("host", "expected"),
        [
            ("localhost", "localhost"),
            ("127.0.0.1", "127.0.0.1"),
            ("::1", "[::1]"),
            ("2001:db8::1", "[2001:db8::1]"),
            ("[::1]", "[::1]"),
            ("0.0.0.0", "0.0.0.0"),
        ],
    )
    def test_format_host_for_url(self, host, expected):
        assert _format_host_for_url(host) == expected

    def test_round_trip_ipv4(self):
        host = "127.0.0.1"
        assert _format_host_for_url(_extract_host(host)) == "127.0.0.1"

    def test_round_trip_ipv6_bare(self):
        host = "::1"
        assert _format_host_for_url(_extract_host(host)) == "[::1]"

    def test_round_trip_ipv6_bracketed(self):
        host = "[::1]:5173"
        assert _format_host_for_url(_extract_host(host)) == "[::1]"

    def test_round_trip_ipv4_with_port(self):
        host = "192.168.1.1:8080"
        assert _format_host_for_url(_extract_host(host)) == "192.168.1.1"


class TestStandaloneImport:
    """Regression tests for issue #66.

    The Hermes dashboard plugin loader has historically loaded the API
    module via ``importlib.util.spec_from_file_location`` with a flat
    module name and no parent package.  Under that loader, the module's
    ``from .graph_data import load_graph`` would raise
    ``ImportError: attempted relative import with no known parent package``,
    causing the FastAPI router to never register and the dashboard to
    fail with ``JSON.parse: unexpected character`` on ``/graph``.

    These tests exercise both loader shapes to ensure the module remains
    portable across Hermes versions.
    """

    def _load(self, fqn: str, *, with_parent_package: bool):
        import importlib.machinery
        import importlib.util

        api_path = Path(__file__).resolve().parents[1] / "plugin_api.py"
        plugin_dir = api_path.parent

        if with_parent_package:
            pkg_name = f"{fqn}_pkg"
            pkg_spec = importlib.machinery.ModuleSpec(pkg_name, None, is_package=True)
            pkg_spec.submodule_search_locations = [str(plugin_dir)]
            pkg_mod = importlib.util.module_from_spec(pkg_spec)
            pkg_mod.__path__ = [str(plugin_dir)]
            sys.modules[pkg_name] = pkg_mod
            spec = importlib.util.spec_from_file_location(f"{pkg_name}.plugin_api", api_path)
            mod = importlib.util.module_from_spec(spec)
            mod.__package__ = pkg_name
            sys.modules[f"{pkg_name}.plugin_api"] = mod
        else:
            spec = importlib.util.spec_from_file_location(fqn, api_path)
            mod = importlib.util.module_from_spec(spec)

        spec.loader.exec_module(mod)
        return mod

    def test_loads_without_parent_package(self):
        """Pre-#66 loader: relative import must fall back gracefully."""
        mod = self._load("issue66_no_parent", with_parent_package=False)
        assert callable(mod.load_graph)
        assert mod.router is not None

    def test_loads_with_parent_package(self):
        """Post-#66 loader: relative import must continue to work."""
        mod = self._load("issue66_with_parent", with_parent_package=True)
        assert callable(mod.load_graph)
        assert mod.router is not None
