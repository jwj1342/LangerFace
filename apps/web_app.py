"""网页界面（Gradio）：上传照片或视频，叠加张力线，可切换 RSTL / Langer。

  python apps/web_app.py
然后浏览器打开提示的本地地址。
"""
from __future__ import annotations

import os
import sys
import tempfile

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from langerlines.config import Config, VALID_SYSTEMS  # noqa: E402
from langerlines.pipeline import LinePipeline         # noqa: E402

DISCLAIMER = (
    "### ⚠️ 医学声明\n"
    "本工具是**决策辅助可视化叠加**，**不是**手术指令，**不是**受监管的医疗器械。\n"
    "内置线条图谱为**示意性首版**，必须经临床医生校验后方可参考。最终切口决策由主刀医生负责。"
)

_pipes: dict[str, LinePipeline] = {}


def _get_pipe(mode: str) -> LinePipeline:
    if mode not in _pipes:
        _pipes[mode] = LinePipeline(Config(), mode=mode)
    return _pipes[mode]


def _to_bgr(image_rgb: np.ndarray) -> np.ndarray:
    """把 Gradio 给的图像（灰度/RGB/RGBA）统一转成 3 通道 BGR。"""
    arr = np.asarray(image_rgb)
    if arr.ndim == 2:
        return cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)
    if arr.shape[2] == 4:
        arr = arr[:, :, :3]
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def process_image(image_rgb: np.ndarray, system: str):
    if image_rgb is None:
        return None
    pipe = _get_pipe("image")
    pipe.set_system(system)
    out = pipe.process(_to_bgr(image_rgb))
    return cv2.cvtColor(out, cv2.COLOR_BGR2RGB)


def process_video(video_path: str, system: str):
    if not video_path:
        return None
    pipe = _get_pipe("video")
    pipe.set_system(system)

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    from langerlines.videoio import make_writer
    out_path = os.path.join(tempfile.gettempdir(), f"langer_out_{os.getpid()}.mp4")
    writer = make_writer(out_path, fps, (w, h))

    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        writer.write(pipe.process(frame, timestamp_ms=int(idx * 1000.0 / fps)))
        idx += 1
    cap.release()
    writer.release()
    return out_path


def build_ui():
    import gradio as gr

    with gr.Blocks(title="朗格线 / RSTL 面部投射") as demo:
        gr.Markdown("# 朗格线 / RSTL 面部投射")
        gr.Markdown(DISCLAIMER)
        system = gr.Radio(VALID_SYSTEMS, value="rstl", label="线系统（rstl=Borges 松弛皮肤张力线，面部首选）")

        with gr.Tab("照片"):
            with gr.Row():
                img_in = gr.Image(label="上传照片", type="numpy")
                img_out = gr.Image(label="叠加结果")
            gr.Button("处理").click(process_image, [img_in, system], img_out)

        with gr.Tab("视频"):
            with gr.Row():
                vid_in = gr.Video(label="上传视频")
                vid_out = gr.Video(label="叠加结果")
            gr.Button("处理").click(process_video, [vid_in, system], vid_out)

    return demo


if __name__ == "__main__":
    build_ui().launch()
