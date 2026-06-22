"""3D 配准：多视角关键点融合 + 标定相机几何。

把模板线/关键点配准到 3D 头模（HeadSpace 风格标定数据）的可复用核心。
渲染（Blender）与数据集 I/O 仍在 tools/headspace/，它们消费本包。
"""
from __future__ import annotations

from .landmarks import (
    build_landmark_weights,
    fuse_landmarks_multiview,
    medoid_fuse,
    normalize_view_weights,
)

__all__ = [
    "build_landmark_weights",
    "normalize_view_weights",
    "medoid_fuse",
    "fuse_landmarks_multiview",
]
