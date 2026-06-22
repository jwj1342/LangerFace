"""稳定性：One-Euro 平滑显著降低视频/实时关键点的帧间抖动。

模拟一组静止关键点叠加高斯抖动，断言平滑后帧间位移远小于原始。
"""
import numpy as np

from langerlines.smoothing import LandmarkSmoother


def _interframe_jitter(seq):
    seq = np.asarray(seq)
    diffs = np.linalg.norm(np.diff(seq, axis=0), axis=-1)  # (T-1, N)
    return float(diffs.mean())


def test_smoothing_reduces_jitter():
    rng = np.random.default_rng(0)
    base = rng.uniform(0, 500, size=(478, 3))
    fps = 30.0
    raw, smoothed = [], []
    sm = LandmarkSmoother(min_cutoff=1.5, beta=0.05)
    for i in range(120):
        noisy = base + rng.normal(0, 1.5, size=base.shape)  # 静止 + 抖动
        raw.append(noisy)
        smoothed.append(sm.filter(noisy, t=i / fps))

    raw_j = _interframe_jitter(raw[5:])
    sm_j = _interframe_jitter(smoothed[5:])
    assert sm_j < 0.5 * raw_j, f"平滑未显著降抖动: raw={raw_j:.3f} sm={sm_j:.3f}"


def test_smoothing_tracks_motion():
    # 匀速平移时，平滑结果应紧跟真值（低滞后）
    fps = 30.0
    sm = LandmarkSmoother(min_cutoff=1.5, beta=0.5)
    last = None
    truth = None
    for i in range(90):
        truth = np.array([[i * 2.0, i * 1.0, 0.0]])
        last = sm.filter(truth, t=i / fps)
    assert np.linalg.norm(last - truth) < 5.0
