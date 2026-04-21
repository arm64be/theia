from __future__ import annotations

from typing import Literal

import numpy as np
from sklearn.decomposition import PCA

Projection = Literal["pca", "umap", "tool-vector"]


def project_to_2d(matrix: np.ndarray, method: Projection = "pca", seed: int = 42) -> np.ndarray:
    """Returns (n, 2) array of positions, normalized to the unit disk."""
    if matrix.shape[0] == 0:
        return np.zeros((0, 2))
    if matrix.shape[0] == 1:
        return np.zeros((1, 2))

    coords: np.ndarray
    if method == "pca":
        n_components = min(2, matrix.shape[1], matrix.shape[0] - 1)
        if n_components < 2:
            # Degenerate case — pad with zero column
            coords = PCA(n_components=n_components, random_state=seed).fit_transform(matrix)
            coords = np.pad(coords, ((0, 0), (0, 2 - n_components)))
        else:
            coords = PCA(n_components=2, random_state=seed).fit_transform(matrix)
    elif method == "umap":
        import umap  # lazy import

        n_neighbors = min(15, matrix.shape[0] - 1)
        reducer = umap.UMAP(n_components=2, random_state=seed, n_neighbors=n_neighbors)
        coords = reducer.fit_transform(matrix)
    elif method == "tool-vector":
        # Pick the two highest-variance features; fallback to first two.
        variances = matrix.var(axis=0)
        idx = np.argsort(variances)[-2:] if matrix.shape[1] >= 2 else np.array([0, 0])
        coords = matrix[:, idx]
    else:
        raise ValueError(f"unknown projection {method!r}")

    # Normalize to unit disk: center, scale so max radius = 1
    coords = coords - coords.mean(axis=0)
    max_r = np.linalg.norm(coords, axis=1).max()
    if max_r > 0:
        coords = coords / max_r
    return coords
