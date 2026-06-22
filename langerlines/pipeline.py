"""高层引擎：一帧进 → 叠加张力线的一帧出。

串起 检测 → 时间平滑 → 图谱映射 → 背面剔除 → 渲染，并管理：
- 每张脸独立的 One-Euro 平滑状态
- 丢脸/重检测时的淡出/淡入（用上一帧映射结果做淡出，避免闪烁）

网页上传、实时摄像头、CLI 三个入口共用这一个引擎。
"""
from __future__ import annotations

import os

import numpy as np

from .atlas import Atlas
from .canonical import CanonicalFaceModel
from .config import Config, VALID_SYSTEMS
from .detector import FaceLandmarkDetector
from .mapping import map_atlas
from .occlusion import BackfaceCuller
from .render import draw_overlay


class LinePipeline:
    def __init__(self, config: Config, detector: FaceLandmarkDetector | None = None,
                 mode: str = "image"):
        self.cfg = config
        self.mode = mode

        self.canonical = CanonicalFaceModel.from_obj(config.canonical_obj)
        self.triangles = self.canonical.triangles
        self.culler = BackfaceCuller(self.triangles) if config.occlusion else None

        # 加载可用的图谱（缺失的系统跳过，运行时若选中再报错）
        self.atlases: dict[str, Atlas] = {}
        for system, path in config.atlas_paths.items():
            if os.path.exists(path):
                self.atlases[system] = Atlas.load(path)

        self.detector = detector or FaceLandmarkDetector(
            model_path=config.landmarker_task,
            mode=mode,
            num_faces=config.num_faces,
            min_face_detection_confidence=config.min_face_detection_confidence,
            min_face_presence_confidence=config.min_face_presence_confidence,
            min_tracking_confidence=config.min_tracking_confidence,
        )

        n = config.num_faces
        self._smoothers = [self._new_smoother() for _ in range(n)]
        self._presence = np.zeros(n, dtype=np.float64)
        self._last_mapped: list[list | None] = [None] * n
        self._last_visible: list[np.ndarray | None] = [None] * n
        self._fade_step = 1.0 / max(1, config.fade_frames)

    def _new_smoother(self):
        from .smoothing import LandmarkSmoother
        return LandmarkSmoother(
            self.cfg.oneeuro_min_cutoff, self.cfg.oneeuro_beta, self.cfg.oneeuro_dcutoff
        )

    def set_system(self, system: str) -> None:
        if system not in VALID_SYSTEMS:
            raise ValueError(f"未知线系统 {system!r}")
        if system not in self.atlases:
            raise ValueError(f"线系统 {system!r} 的图谱未找到/未加载")
        self.cfg.system = system

    # ── 主入口 ─────────────────────────────────────────────────────────────────
    def process(self, frame_bgr: np.ndarray, timestamp_ms: int | None = None) -> np.ndarray:
        if self.cfg.system not in self.atlases:
            raise ValueError(
                f"线系统 {self.cfg.system!r} 的图谱缺失。"
                f"请先运行 tools/build_initial_atlas.py 生成图谱。"
            )
        atlas = self.atlases[self.cfg.system]
        style = self.cfg.style()
        t_sec = (timestamp_ms or 0) / 1000.0

        faces = self.detector.detect(frame_bgr, timestamp_ms)
        out = frame_bgr

        for i in range(self.cfg.num_faces):
            if i < len(faces):
                lm = faces[i].landmarks_px
                if self.cfg.smoothing and self.mode == "video":
                    lm = self._smoothers[i].filter(lm, t_sec)
                mapped = map_atlas(atlas, lm, self.triangles)
                visible = self.culler.visible_triangles(lm) if self.culler else None
                self._last_mapped[i] = mapped
                self._last_visible[i] = visible
                self._presence[i] = min(1.0, self._presence[i] + self._fade_step)
            else:
                # 丢脸：用上一帧结果淡出
                self._presence[i] = max(0.0, self._presence[i] - self._fade_step)
                if self._presence[i] <= 0.0:
                    self._smoothers[i].reset()
                    self._last_mapped[i] = None
                mapped = self._last_mapped[i]
                visible = self._last_visible[i]

            if mapped is not None and self._presence[i] > 0.0:
                out = draw_overlay(out, mapped, visible, style, global_alpha=float(self._presence[i]))
        return out

    def close(self) -> None:
        self.detector.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
