"""与领域无关的几何基元（标准脸模型、重心坐标）。

Stage 2（肿物/切口）与 3D 重建复用这一层。刚性对齐（Umeyama）后续从
tools/reconstruct_3d.py 收敛到本包的 alignment.py。
"""
from __future__ import annotations

from .barycentric import barycentric_batch
from .canonical import CanonicalFaceModel

__all__ = ["CanonicalFaceModel", "barycentric_batch"]
