"""检测层的稳定契约：FaceResult 数据结构 + Detector 协议。

pipeline/ 只依赖这个协议，不依赖具体实现，因此可替换检测后端
（MediaPipe、未来的 3D 检测器等）而无需改动编排逻辑。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import numpy as np


@dataclass
class FaceResult:
    landmarks_px: np.ndarray       # (478, 3) 图像空间 (x_px, y_px, z*width)
    normalized: np.ndarray         # (478, 3) 归一化 (x,y in [0,1], z)
    transform: np.ndarray | None   # (4,4) 头部位姿矩阵或 None


@runtime_checkable
class Detector(Protocol):
    """人脸关键点检测器契约。"""

    def detect(self, frame_bgr: np.ndarray, timestamp_ms: int | None = None) -> list[FaceResult]:
        ...

    def close(self) -> None:
        ...
