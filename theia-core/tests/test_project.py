import numpy as np
import pytest

from theia_core.project import project_to_2d


def test_project_pca_within_unit_disk() -> None:
    rng = np.random.default_rng(0)
    matrix = rng.normal(size=(10, 8))

    coords = project_to_2d(matrix, method="pca")

    assert coords.shape == (10, 2)
    radii = np.linalg.norm(coords, axis=1)
    assert radii.max() == pytest.approx(1.0, abs=1e-9)


def test_project_pca_deterministic() -> None:
    rng = np.random.default_rng(0)
    matrix = rng.normal(size=(10, 8))

    a = project_to_2d(matrix, method="pca", seed=42)
    b = project_to_2d(matrix, method="pca", seed=42)

    assert np.allclose(a, b)


def test_project_handles_single_row() -> None:
    matrix = np.ones((1, 5))
    coords = project_to_2d(matrix, method="pca")

    assert coords.shape == (1, 2)
