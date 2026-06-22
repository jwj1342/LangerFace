"""Pipeline 公共 API 与丢脸淡出逻辑。

用一个实现 Detector 协议的假检测器注入 pipeline，无需 MediaPipe；
端到端 process（需 cv2 + 图谱）单独门控。
"""
import numpy as np
import pytest

from langerface.config import SYSTEM_RSTL, build_config
from langerface.detection.base import FaceResult
from langerface.pipeline import LinePipeline

from .conftest import requires_canonical, requires_rstl_atlas


class _FakeDetector:
    """可控假检测器：present 决定是否返回一张脸。实现 detection.base.Detector。"""

    def __init__(self, landmarks: np.ndarray):
        self._lm = landmarks
        self.present = True
        self.closed = False

    def detect(self, frame_bgr, timestamp_ms=None):
        if not self.present:
            return []
        return [FaceResult(landmarks_px=self._lm, normalized=self._lm, transform=None)]

    def close(self):
        self.closed = True


@requires_canonical
def test_set_occlusion_toggles_culler(canonical):
    pipe = LinePipeline(build_config(occlusion=True),
                        detector=_FakeDetector(np.zeros((478, 3))), mode="image")
    assert pipe.culler is not None
    pipe.set_occlusion(False)
    assert pipe.culler is None
    pipe.set_occlusion(True)
    assert pipe.culler is not None


@requires_canonical
def test_set_smoothing_updates_flag(canonical):
    pipe = LinePipeline(build_config(), detector=_FakeDetector(np.zeros((478, 3))), mode="video")
    pipe.set_smoothing(False)
    assert pipe.cfg.smoothing is False


@requires_canonical
def test_set_system_rejects_unknown(canonical):
    pipe = LinePipeline(build_config(), detector=_FakeDetector(np.zeros((478, 3))), mode="image")
    with pytest.raises(ValueError):
        pipe.set_system("does-not-exist")


@requires_canonical
def test_close_propagates_to_detector(canonical):
    fake = _FakeDetector(np.zeros((478, 3)))
    with LinePipeline(build_config(), detector=fake, mode="image"):
        pass
    assert fake.closed is True


@requires_rstl_atlas
def test_fade_out_after_face_lost(canonical, synthetic_landmarks):
    lm, (w, h) = synthetic_landmarks()
    fake = _FakeDetector(lm)
    cfg = build_config(SYSTEM_RSTL, occlusion=False)  # 关遮挡，简化断言
    cfg.fade_frames = 3
    pipe = LinePipeline(cfg, detector=fake, mode="video")
    frame = np.zeros((h, w, 3), dtype=np.uint8)

    for i in range(5):                                 # 有脸：presence 升到 1
        pipe.process(frame, timestamp_ms=i * 33)
    assert pipe._presence[0] == pytest.approx(1.0)

    fake.present = False                               # 丢脸：逐帧淡出
    for i in range(5, 5 + cfg.fade_frames + 1):
        pipe.process(frame, timestamp_ms=i * 33)
    assert pipe._presence[0] == pytest.approx(0.0)
    assert pipe._last_mapped[0] is None
