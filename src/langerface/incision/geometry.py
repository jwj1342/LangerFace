"""Small vector helpers for incision geometry."""
from __future__ import annotations

import numpy as np


def normalize(v: tuple[float, float, float] | list[float] | np.ndarray) -> np.ndarray:
    arr = np.asarray(v, dtype=np.float64)
    n = float(np.linalg.norm(arr))
    if n < 1e-12:
        return np.array([1.0, 0.0, 0.0])
    return arr / n


def tangent_perp(axis: np.ndarray, normal: np.ndarray | None = None) -> np.ndarray:
    axis = normalize(axis)
    n = normalize(normal if normal is not None else np.array([0.0, 0.0, 1.0]))
    perp = np.cross(n, axis)
    if float(np.linalg.norm(perp)) < 1e-9:
        perp = np.array([-axis[1], axis[0], 0.0])
    return normalize(perp)


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def units_per_mm_from_vertices(vertices: np.ndarray, face_height_mm: float = 180.0) -> float:
    V = np.asarray(vertices, dtype=np.float64)
    if len(V) == 0:
        return 1.0
    height = float(V[:, 1].max() - V[:, 1].min())
    return height / face_height_mm if height > 1e-9 else 1.0
