"""渲染层：叠加折线渲染 + 自遮挡（背面剔除）。"""
from __future__ import annotations

from .occlusion import BackfaceCuller
from .overlay import draw_overlay

__all__ = ["BackfaceCuller", "draw_overlay"]
