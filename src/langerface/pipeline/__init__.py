"""高层编排：检测 → 平滑 → 映射 → 剔除 → 渲染。"""
from __future__ import annotations

from .line_pipeline import LinePipeline

__all__ = ["LinePipeline"]
