"""集中配置：资产路径、线系统、渲染样式、稳定性阈值。"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

# ── 线系统标识 ────────────────────────────────────────────────────────────────
SYSTEM_RSTL = "rstl"      # Borges 松弛皮肤张力线（面部手术首选，默认）
SYSTEM_LANGER = "langer"  # 经典 Langer 裂线
VALID_SYSTEMS = (SYSTEM_RSTL, SYSTEM_LANGER)

# ── 路径 ──────────────────────────────────────────────────────────────────────
PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(PACKAGE_DIR)
ASSETS_DIR = os.path.join(REPO_DIR, "assets")

CANONICAL_OBJ = os.path.join(ASSETS_DIR, "canonical_face_model.obj")
FACE_LANDMARKER_TASK = os.path.join(ASSETS_DIR, "face_landmarker.task")
ATLAS_PATHS = {
    SYSTEM_RSTL: os.path.join(ASSETS_DIR, "atlas_rstl.json"),
    SYSTEM_LANGER: os.path.join(ASSETS_DIR, "atlas_langer.json"),
}


@dataclass
class LineStyle:
    """单套线系统的渲染样式（BGR 颜色，OpenCV 约定）。"""
    color: tuple[int, int, int]
    thickness: int = 2
    alpha: float = 0.85          # 叠加层不透明度
    draw_direction_ticks: bool = False


# 高对比配色，便于在肤色上清晰可见（BGR）：RSTL 用品红/紫（贴近手术划线笔），Langer 用亮青
# thickness=1 配合稠密流线场（细线、布满全脸）
DEFAULT_STYLES = {
    SYSTEM_RSTL: LineStyle(color=(255, 0, 200), thickness=1, alpha=0.9),
    SYSTEM_LANGER: LineStyle(color=(255, 200, 0), thickness=1, alpha=0.9),
}


@dataclass
class Config:
    """运行期配置。"""
    system: str = SYSTEM_RSTL
    num_faces: int = 1

    # 检测置信度门控
    min_face_detection_confidence: float = 0.5
    min_face_presence_confidence: float = 0.5
    min_tracking_confidence: float = 0.5

    # 稳定性
    smoothing: bool = True            # One-Euro 时间平滑（视频/实时）
    occlusion: bool = True            # 背面剔除（侧脸只显示可见侧）
    fade_frames: int = 6              # 丢脸后淡出 / 重新检测后淡入的帧数

    # One-Euro 参数（数值越小越平滑、滞后越大）
    oneeuro_min_cutoff: float = 1.5
    oneeuro_beta: float = 0.05
    oneeuro_dcutoff: float = 1.0

    # 渲染
    styles: dict = field(default_factory=lambda: dict(DEFAULT_STYLES))

    # 资产
    canonical_obj: str = CANONICAL_OBJ
    landmarker_task: str = FACE_LANDMARKER_TASK
    atlas_paths: dict = field(default_factory=lambda: dict(ATLAS_PATHS))

    def style(self) -> LineStyle:
        return self.styles[self.system]

    def validate_system(self, system: str) -> str:
        if system not in VALID_SYSTEMS:
            raise ValueError(f"未知线系统 {system!r}，可选 {VALID_SYSTEMS}")
        return system
