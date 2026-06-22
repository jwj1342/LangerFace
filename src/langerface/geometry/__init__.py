"""与领域无关的几何基元（标准脸模型、重心坐标、Sim3 对齐、折线）。

Stage 2（肿物/切口）、3D 重建与离线 HeadSpace 配准管线复用这一层。
刚性 + 尺度对齐（Umeyama / 加权 Sim3）已收敛到 alignment.py。
"""
from __future__ import annotations

from .alignment import apply_sim3, sim3_matrix, umeyama, weighted_umeyama_sim3
from .barycentric import barycentric_batch
from .canonical import CanonicalFaceModel
from .polyline import resample_polyline_arclen

__all__ = [
    "CanonicalFaceModel",
    "barycentric_batch",
    "weighted_umeyama_sim3",
    "umeyama",
    "apply_sim3",
    "sim3_matrix",
    "resample_polyline_arclen",
]
