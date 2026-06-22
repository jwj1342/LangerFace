"""运行期配置数据模型与构造工厂。"""
from __future__ import annotations

from dataclasses import dataclass, field

from .assets import ATLAS_PATHS, CANONICAL_OBJ, FACE_LANDMARKER_TASK
from .constants import (
    DEFAULT_FADE_FRAMES,
    ONEEURO_BETA,
    ONEEURO_DCUTOFF,
    ONEEURO_MIN_CUTOFF,
    SYSTEM_LANGER,
    SYSTEM_RSTL,
    VALID_SYSTEMS,
)


@dataclass
class LineStyle:
    """单套线系统的渲染样式（BGR 颜色，OpenCV 约定）。"""
    color: tuple[int, int, int]
    thickness: int = 2
    alpha: float = 0.85          # 叠加层不透明度
    draw_direction_ticks: bool = False


# 高对比配色，便于在肤色上清晰可见（BGR）：RSTL 用品红/紫（贴近手术划线笔），Langer 用亮青。
# thickness=1 配合稠密流线场（细线、布满全脸）。
DEFAULT_STYLES = {
    SYSTEM_RSTL: LineStyle(color=(255, 0, 200), thickness=1, alpha=0.9),
    SYSTEM_LANGER: LineStyle(color=(255, 200, 0), thickness=1, alpha=0.9),
}


@dataclass
class Config:
    """运行期配置。默认值取自 config.constants（单一事实来源）。"""
    system: str = SYSTEM_RSTL
    num_faces: int = 1

    # 检测置信度门控
    min_face_detection_confidence: float = 0.5
    min_face_presence_confidence: float = 0.5
    min_tracking_confidence: float = 0.5

    # 稳定性
    smoothing: bool = True                       # One-Euro 时间平滑（视频/实时）
    occlusion: bool = True                       # 背面剔除（侧脸只显示可见侧）
    fade_frames: int = DEFAULT_FADE_FRAMES       # 丢脸后淡出 / 重新检测后淡入帧数

    # One-Euro 参数（数值越小越平滑、滞后越大）
    oneeuro_min_cutoff: float = ONEEURO_MIN_CUTOFF
    oneeuro_beta: float = ONEEURO_BETA
    oneeuro_dcutoff: float = ONEEURO_DCUTOFF

    # 渲染
    styles: dict = field(default_factory=lambda: dict(DEFAULT_STYLES))

    # 资产
    canonical_obj: str = CANONICAL_OBJ
    landmarker_task: str = FACE_LANDMARKER_TASK
    atlas_paths: dict = field(default_factory=lambda: dict(ATLAS_PATHS))

    def style(self) -> LineStyle:
        return self.styles[self.system]

    @staticmethod
    def validate_system(system: str) -> str:
        if system not in VALID_SYSTEMS:
            raise ValueError(f"未知线系统 {system!r}，可选 {VALID_SYSTEMS}")
        return system


def build_config(
    system: str = SYSTEM_RSTL,
    num_faces: int = 1,
    smoothing: bool = True,
    occlusion: bool = True,
) -> Config:
    """统一的 Config 构造工厂（cli / webcam / web 共用，消除三处重复构造）。"""
    Config.validate_system(system)
    return Config(
        system=system,
        num_faces=num_faces,
        smoothing=smoothing,
        occlusion=occlusion,
    )
