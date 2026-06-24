"""结构化可观测性（issue #51）单测。

不触 cv2 / mediapipe（本机不可装）：用伪检测器 / 伪 landmarker，仅断言
``extra={...}`` 字段是否落到日志记录上（``record.<field>``），并校验失败原因
取自可枚举的 ``DetectFailureReason``。字段命名与 web 端 / OBSERVABILITY.md 单一真源。
"""
import logging

import numpy as np
import pytest

from langerface.detection.base import FaceResult
from langerface.log import (
    DetectFailureReason,
    Phase,
    log_stage_duration,
)

from .conftest import requires_canonical, requires_rstl_atlas


def _records_for_event(caplog, event):
    return [r for r in caplog.records if getattr(r, "event", None) == event]


def test_failure_reason_constants_are_enumerable():
    """所有 reason 取值都在 ALL 集合里（防止散落自由文本）。"""
    for name in (
        DetectFailureReason.NO_FACE,
        DetectFailureReason.NO_TIMESTAMP,
        DetectFailureReason.ATLAS_MISSING,
        DetectFailureReason.NO_ATLAS_LOADED,
        DetectFailureReason.DETECTOR_CLOSE_ERROR,
    ):
        assert name in DetectFailureReason.ALL
        assert name.islower()


def test_log_stage_duration_emits_structured_durationms(caplog):
    """阶段计时上下文管理器落 event / phase / durationMs。"""
    log = logging.getLogger("langerface.test.stage")
    with caplog.at_level(logging.DEBUG, logger="langerface.test.stage"):
        with log_stage_duration(log, "frame.detect", Phase.DETECT):
            pass
    recs = _records_for_event(caplog, "frame.detect")
    assert recs, "未发出 frame.detect 计时记录"
    rec = recs[-1]
    assert rec.phase == Phase.DETECT
    assert isinstance(rec.durationMs, float)
    assert rec.durationMs >= 0.0
    assert rec.failed is False


def test_log_stage_duration_logs_durationms_even_on_exception(caplog):
    """异常照常上抛，但仍带 durationMs 落一条（failed=True）。"""
    log = logging.getLogger("langerface.test.stage")
    with caplog.at_level(logging.DEBUG, logger="langerface.test.stage"):
        with pytest.raises(RuntimeError):
            with log_stage_duration(log, "frame.detect", Phase.DETECT):
                raise RuntimeError("boom")
    rec = _records_for_event(caplog, "frame.detect")[-1]
    assert rec.failed is True
    assert isinstance(rec.durationMs, float)


# ── 流水线集成（伪检测器，不触 cv2/mediapipe）────────────────────────────────
class _FakeDetector:
    """可控的检测器替身（满足 Detector 协议）：face_count 帧返回的人脸数。

    face_count=0 时不触发渲染（draw_overlay 才会延迟导入 cv2），保证测试无 cv2 依赖。
    """

    def __init__(self, landmarks, face_count=1):
        self._landmarks = landmarks
        self._face_count = face_count
        self.closed = False

    def detect(self, frame_bgr, timestamp_ms=None):
        return [
            FaceResult(
                landmarks_px=self._landmarks, normalized=self._landmarks, transform=None
            )
            for _ in range(self._face_count)
        ]

    def close(self):
        self.closed = True


def _build_pipeline(detector):
    # 关掉平滑/遮挡：避免渲染分支与 culler，保持纯逻辑（不触 cv2）。
    from langerface.config import build_config
    from langerface.pipeline.line_pipeline import LinePipeline

    cfg = build_config(system="rstl", num_faces=1, smoothing=False, occlusion=False)
    return LinePipeline(cfg, detector=detector, mode="image")


@requires_canonical
@requires_rstl_atlas
def test_asset_version_logging_fires(canonical, rstl_atlas, synthetic_landmarks, caplog):
    """构造 LinePipeline 时一次性记录 assets.loaded，含 assetVersions + langerfaceVersion。"""
    import langerface

    lm, _ = synthetic_landmarks()
    with caplog.at_level(logging.INFO, logger="langerface.pipeline.line_pipeline"):
        _build_pipeline(_FakeDetector(lm))
    recs = _records_for_event(caplog, "assets.loaded")
    assert recs, "未发出 assets.loaded 资产版本记录"
    av = recs[-1].assetVersions
    assert av["langerfaceVersion"] == langerface.__version__
    assert "atlasVersions" in av
    assert recs[-1].phase == Phase.ASSETS


@requires_canonical
@requires_rstl_atlas
def test_no_face_emits_enumerable_reason(canonical, rstl_atlas, synthetic_landmarks, caplog):
    """丢脸帧发结构化记录，reason 取自可枚举集合。"""
    lm, _ = synthetic_landmarks()
    pipe = _build_pipeline(_FakeDetector(lm, face_count=0))
    frame = np.zeros((64, 64, 3), dtype=np.uint8)
    with caplog.at_level(logging.DEBUG, logger="langerface.pipeline.line_pipeline"):
        pipe.process(frame, timestamp_ms=0)
    recs = _records_for_event(caplog, "frame.noFace")
    assert recs, "丢脸帧未发出 frame.noFace 记录"
    assert recs[-1].reason == DetectFailureReason.NO_FACE
    assert recs[-1].reason in DetectFailureReason.ALL


@requires_canonical
@requires_rstl_atlas
def test_detect_phase_logs_durationms(canonical, rstl_atlas, synthetic_landmarks, caplog):
    """process() 的 detect 阶段落 durationMs。"""
    lm, _ = synthetic_landmarks()
    # face_count=0：detect 阶段计时仍照常发出，但不进入渲染分支（不触 cv2）。
    pipe = _build_pipeline(_FakeDetector(lm, face_count=0))
    frame = np.zeros((64, 64, 3), dtype=np.uint8)
    with caplog.at_level(logging.DEBUG, logger="langerface.pipeline.line_pipeline"):
        pipe.process(frame, timestamp_ms=0)
    recs = _records_for_event(caplog, "frame.detect")
    assert recs, "detect 阶段未落 durationMs 记录"
    assert recs[-1].phase == Phase.DETECT
    assert isinstance(recs[-1].durationMs, float)
