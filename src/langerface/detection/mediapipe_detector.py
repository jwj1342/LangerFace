"""人脸关键点检测：MediaPipe Face Landmarker 封装（实现 detection.base.Detector）。

输出 478 个 3D 关键点（前 468 个对应标准网格顶点；后 10 个为虹膜）。
- IMAGE 模式：单张图片
- VIDEO 模式：视频/实时摄像头逐帧（带时间戳，利用内部跟踪更稳）
"""
from __future__ import annotations

import numpy as np

from ..config.assets import require_asset
from ..log import get_logger
from .base import FaceResult

log = get_logger(__name__)


class FaceLandmarkDetector:
    def __init__(
        self,
        model_path: str,
        mode: str = "image",
        num_faces: int = 1,
        min_face_detection_confidence: float = 0.5,
        min_face_presence_confidence: float = 0.5,
        min_tracking_confidence: float = 0.5,
    ):
        require_asset(model_path, what="Face Landmarker 模型")
        # 延迟导入，避免未装 mediapipe 时整个包不可导入（也便于纯几何单测）。
        try:
            import mediapipe as mp
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision
        except ImportError as exc:  # 检测后端是可选的，给出明确安装指引
            raise ImportError(
                "需要 mediapipe 检测后端，但未安装。请运行  pip install 'langerface[mediapipe]'"
            ) from exc

        self._mp = mp
        self._vision = vision
        self.mode = mode
        running_mode = vision.RunningMode.VIDEO if mode == "video" else vision.RunningMode.IMAGE

        options = vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=model_path),
            running_mode=running_mode,
            num_faces=num_faces,
            min_face_detection_confidence=min_face_detection_confidence,
            min_face_presence_confidence=min_face_presence_confidence,
            min_tracking_confidence=min_tracking_confidence,
            output_face_blendshapes=False,
            output_facial_transformation_matrixes=True,
        )
        self._landmarker = vision.FaceLandmarker.create_from_options(options)

    def detect(self, frame_bgr: np.ndarray, timestamp_ms: int | None = None) -> list[FaceResult]:
        """检测一帧（BGR），返回每张脸的 FaceResult 列表。"""
        import cv2

        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        mp_image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        h, w = frame_bgr.shape[:2]

        if self.mode == "video":
            if timestamp_ms is None:
                raise ValueError("VIDEO 模式需要 timestamp_ms")
            result = self._landmarker.detect_for_video(mp_image, int(timestamp_ms))
        else:
            result = self._landmarker.detect(mp_image)

        faces: list[FaceResult] = []
        transforms = getattr(result, "facial_transformation_matrixes", None) or []
        for i, lms in enumerate(result.face_landmarks):
            norm = np.array([[lm.x, lm.y, lm.z] for lm in lms], dtype=np.float64)
            px = norm.copy()
            px[:, 0] *= w
            px[:, 1] *= h
            px[:, 2] *= w  # z 与 x 同尺度，便于 3D 法向计算
            tf = None
            if i < len(transforms):
                tf = np.asarray(transforms[i], dtype=np.float64).reshape(4, 4)
            faces.append(FaceResult(landmarks_px=px, normalized=norm, transform=tf))
        return faces

    def close(self) -> None:
        try:
            self._landmarker.close()
        except Exception as exc:  # 仅记录，不让清理错误掩盖主流程
            log.warning("关闭 FaceLandmarker 时出错: %s", exc)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
