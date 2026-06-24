"""视频 I/O 与逐帧处理（消除 cli / webcam / web 三处重复的打开-读元数据-循环）。

- make_writer:        优先浏览器可播放的 H.264(avc1)，回退 mp4v
- VideoMeta/read_meta: 统一读取 fps/宽高/帧数
- process_video:      打开输入→逐帧 processor(frame, ts)→写出，返回处理帧数
- iter_frames:        逐帧生成器（供摄像头等自定义循环复用读帧逻辑）

cv2 延迟导入，保持纯逻辑模块在无 OpenCV 环境下可被导入。
"""
from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass

import numpy as np

from ..log import Phase, get_logger

log = get_logger(__name__)

# 一帧处理器：吃 (BGR 帧, 时间戳毫秒) 吐 BGR 帧。
FrameProcessor = Callable[[np.ndarray, "int | None"], np.ndarray]


@dataclass
class VideoMeta:
    fps: float
    width: int
    height: int
    frame_count: int

    @property
    def size(self) -> tuple[int, int]:
        return (self.width, self.height)


def make_writer(path: str, fps: float, size: tuple[int, int]):
    """返回打开的 VideoWriter。优先 avc1（H.264，浏览器可播），失败回退 mp4v。"""
    import cv2

    for cc in ("avc1", "mp4v"):
        writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*cc), fps, size)
        if writer.isOpened():
            return writer
        writer.release()
    raise RuntimeError(f"无法为 {path} 创建 VideoWriter")


def read_meta(cap, fps_default: float = 25.0) -> VideoMeta:
    """从已打开的 VideoCapture 读取元数据。"""
    import cv2

    fps = cap.get(cv2.CAP_PROP_FPS) or fps_default
    return VideoMeta(
        fps=fps,
        width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        frame_count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
    )


def iter_frames(cap) -> Iterator[np.ndarray]:
    """逐帧产出 BGR 帧，直到读尽。"""
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        yield frame


def process_video(
    input_path: str,
    output_path: str,
    processor: FrameProcessor,
    *,
    fps_default: float = 25.0,
    progress_every: int = 30,
) -> int:
    """打开输入视频，逐帧交给 processor，写出到 output_path，返回处理帧数。

    时间戳由帧序号与 fps 推导（毫秒），与原 cli/web 行为一致。
    """
    import cv2

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise FileNotFoundError(f"无法打开视频 {input_path}")
    t_start = time.perf_counter()
    try:
        meta = read_meta(cap, fps_default)
        writer = make_writer(output_path, meta.fps, meta.size)
        try:
            idx = 0
            for frame in iter_frames(cap):
                ts = int(idx * 1000.0 / meta.fps)
                # 逐帧阶段耗时（perf_counter）：每帧测得 durationMs，用于聚合 fps/耗时指标。
                t_frame = time.perf_counter()
                writer.write(processor(frame, ts))
                frame_ms = (time.perf_counter() - t_frame) * 1000.0
                idx += 1
                if progress_every and idx % progress_every == 0:
                    log.info(
                        "已处理 %d 帧",
                        idx,
                        extra={
                            "event": "frame.progress",
                            "phase": Phase.FRAME,
                            "durationMs": frame_ms,
                            "framesProcessed": idx,
                        },
                    )
        finally:
            writer.release()
    finally:
        cap.release()
    total_ms = (time.perf_counter() - t_start) * 1000.0
    log.info(
        "已写出 %s（%d 帧）",
        output_path,
        idx,
        extra={
            "event": "video.finished",
            "phase": Phase.FRAME,
            "durationMs": total_ms,
            "framesProcessed": idx,
            "fps": (idx / (total_ms / 1000.0)) if total_ms > 0 else 0.0,
        },
    )
    return idx
