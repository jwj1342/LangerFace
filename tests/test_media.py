"""media.video 纯逻辑（不触 OpenCV）。"""
from langerface.media import VideoMeta


def test_video_meta_size():
    meta = VideoMeta(fps=30.0, width=1280, height=720, frame_count=90)
    assert meta.size == (1280, 720)
