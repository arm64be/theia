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
