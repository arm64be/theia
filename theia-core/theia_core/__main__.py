from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any, Literal, cast

from theia_core.detect.cross_search import detect_cross_search
from theia_core.detect.memory_share import detect_memory_share
from theia_core.detect.subagent import detect_subagent
from theia_core.detect.tool_overlap import detect_tool_overlap
from theia_core.emit import build_graph, write_graph
from theia_core.features import build_feature_matrix
from theia_core.ingest import load_sessions
from theia_core.project import project_to_2d
from theia_core.watch import watch_db


def _theia_home() -> Path:
    return Path(os.environ.get("THEIA_HOME", Path.home() / ".hermes"))


def _build(
    sessions: list[Any],
    *,
    projection: str,
    include_features: bool,
    disable_tool_overlap: bool,
) -> dict[str, Any]:
    edges = detect_memory_share(sessions) + detect_cross_search(sessions)
    edges += detect_subagent(sessions)
    if not disable_tool_overlap:
        edges += detect_tool_overlap(sessions)

    matrix, feature_names = build_feature_matrix(sessions)
    positions = project_to_2d(
        matrix, method=cast("Literal['pca', 'umap', 'tool-vector']", projection)
    )
    graph = build_graph(
        sessions=sessions,
        edges=edges,
        positions=positions,
        projection=projection,
        feature_dim=len(feature_names),
    )
    if include_features:
        for i, node in enumerate(graph["nodes"]):
            node["features"] = matrix[i].tolist()
    return graph


def main(argv: list[str] | None = None) -> int:
    theia_home = _theia_home()

    parser = argparse.ArgumentParser(
        prog="theia-core",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--db-path",
        type=Path,
        default=theia_home / "state.db",
        help="path to Hermes SQLite database",
    )
    parser.add_argument(
        "-o",
        "--out",
        type=Path,
        default=theia_home / "theia-graph.json",
        help="output graph JSON path",
    )
    parser.add_argument(
        "--projection",
        choices=["pca", "umap", "tool-vector"],
        default="umap",
        help="dimensionality reduction method",
    )
    parser.add_argument(
        "--include-features", action="store_true", help="include per-node feature vectors in output"
    )
    parser.add_argument(
        "--disable-tool-overlap", action="store_true", help="skip tool-overlap edge detection"
    )
    parser.add_argument(
        "--watch", action="store_true", help="regenerate graph when the database changes"
    )
    parser.add_argument(
        "--watch-interval",
        type=float,
        default=1.0,
        help="polling interval in seconds",
    )
    args = parser.parse_args(argv)

    def generate() -> None:
        sessions = load_sessions(args.db_path)
        if not sessions:
            print(f"warning: no sessions found in {args.db_path}")
            return
        graph = _build(
            sessions,
            projection=args.projection,
            include_features=args.include_features,
            disable_tool_overlap=args.disable_tool_overlap,
        )
        write_graph(graph, args.out)
        print(f"wrote {args.out} — {len(graph['nodes'])} nodes, {len(graph['edges'])} edges")

    generate()

    if args.watch:
        watch_db(
            args.db_path,
            callback=generate,
            interval=args.watch_interval,
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
