"""集中配置：资产路径、线系统、渲染样式、稳定性阈值。

``langerface.config`` 是稳定的公共边界 —— 调用方从这里取所有配置符号，
内部 settings/constants/assets 的拆分对外隐藏。
"""
from __future__ import annotations

from .assets import (
    ASSETS_DIR,
    ATLAS_PATHS,
    CANONICAL_OBJ,
    FACE_LANDMARKER_TASK,
    assets_dir,
    require_asset,
)
from .constants import (
    ATLAS_VERSION,
    DEFAULT_FADE_FRAMES,
    DEFAULT_OCCLUSION_THRESHOLD,
    FACE_FRAME_ANCHORS,
    NOSE_TIP,
    ONEEURO_BETA,
    ONEEURO_DCUTOFF,
    ONEEURO_MIN_CUTOFF,
    SYSTEM_LANGER,
    SYSTEM_RSTL,
    VALID_SYSTEMS,
)
from .settings import DEFAULT_STYLES, Config, LineStyle, build_config

__all__ = [
    # 线系统
    "SYSTEM_RSTL", "SYSTEM_LANGER", "VALID_SYSTEMS", "ATLAS_VERSION",
    # 配置
    "Config", "LineStyle", "DEFAULT_STYLES", "build_config",
    # 常量
    "NOSE_TIP", "FACE_FRAME_ANCHORS", "DEFAULT_OCCLUSION_THRESHOLD",
    "ONEEURO_MIN_CUTOFF", "ONEEURO_BETA", "ONEEURO_DCUTOFF", "DEFAULT_FADE_FRAMES",
    # 资产
    "ASSETS_DIR", "CANONICAL_OBJ", "FACE_LANDMARKER_TASK", "ATLAS_PATHS",
    "assets_dir", "require_asset",
]
