"""视频写出工具：优先用浏览器可播放的 H.264(avc1)，回退到 mp4v。"""
from __future__ import annotations

import cv2


def make_writer(path: str, fps: float, size: tuple[int, int]) -> cv2.VideoWriter:
    """返回打开的 VideoWriter。优先 avc1（H.264，浏览器可播），失败回退 mp4v。"""
    for cc in ("avc1", "mp4v"):
        writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*cc), fps, size)
        if writer.isOpened():
            return writer
        writer.release()
    raise RuntimeError(f"无法为 {path} 创建 VideoWriter")
