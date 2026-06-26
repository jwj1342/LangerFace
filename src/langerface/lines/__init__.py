"""Stage 1 领域：朗格 / RSTL 线图谱（数据模型与映射）。

图谱的离线构建工具仍在 tools/build_field_atlas.py，后续将其几何/流线追踪
逻辑收敛到本包的 builder.py。
"""
from __future__ import annotations

from .atlas import Atlas, AtlasLine
from .build import atlas_line_from_points2d
from .mapping import MappedLine, map_atlas

__all__ = [
    "Atlas",
    "AtlasLine",
    "MappedLine",
    "atlas_line_from_points2d",
    "map_atlas",
]
