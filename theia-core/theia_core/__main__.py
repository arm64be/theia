from __future__ import annotations

import argparse
from pathlib import Path

from theia_core.detect.cross_search import detect_cross_search
from theia_core.detect.memory_share import detect_memory_share
from theia_core.detect.tool_overlap import detect_tool_overlap
from theia_core.emit import build_graph, write_graph
from theia_core.features import build_feature_matrix
from theia_core.ingest import load_sessions
from theia_core.project import project_to_2d


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="theia-core")
    parser.add_argument("sessions_dir", type=Path)
    parser.add_argument("-o", "--out", type=Path, default=Path("graph.json"))
    parser.add_argument("--projection", choices=["pca", "umap", "tool-vector"], default="umap")
    parser.add_argument("--include-features", action="store_true")
    parser.add_argument("--disable-tool-overlap", action="store_true")
    args = parser.parse_args(argv)

    sessions = load_sessions(args.sessions_dir)
    if not sessions:
        parser.error(f"no session JSONs found in {args.sessions_dir}")

    edges = detect_memory_share(sessions) + detect_cross_search(sessions)
    if not args.disable_tool_overlap:
        edges += detect_tool_overlap(sessions)

    matrix, feature_names = build_feature_matrix(sessions)
    positions = project_to_2d(matrix, method=args.projection)
    graph = build_graph(
        sessions=sessions,
        edges=edges,
        positions=positions,
        projection=args.projection,
        feature_dim=len(feature_names),
    )
    if args.include_features:
        for i, node in enumerate(graph["nodes"]):
            node["features"] = matrix[i].tolist()

    write_graph(graph, args.out)
    print(f"wrote {args.out} — {len(graph['nodes'])} nodes, {len(graph['edges'])} edges")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
