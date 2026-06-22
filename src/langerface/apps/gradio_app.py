"""网页界面（Gradio）：上传照片或视频，叠加张力线，可切换 RSTL / Langer。

  langerface-web
（或：python -m langerface.apps.gradio_app）
然后浏览器打开提示的本地地址。

注：这是后端的快速演示界面；正式前端在 web/（静态站点，经 CI/CD 部署）。
"""
from __future__ import annotations

import os
import tempfile

from ..config.constants import VALID_SYSTEMS
from ..config.settings import Config
from ..log import configure_logging, get_logger
from ..media.video import process_video
from ..pipeline.line_pipeline import LinePipeline

log = get_logger(__name__)

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


def _to_bgr(image_rgb):
    """把 Gradio 给的图像（灰度/RGB/RGBA）统一转成 3 通道 BGR。"""
    import cv2
    import numpy as np

    arr = np.asarray(image_rgb)
    if arr.ndim == 2:
        return cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)
    if arr.shape[2] == 4:
        arr = arr[:, :, :3]
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def process_image(image_rgb, system: str):
    import cv2

    if image_rgb is None:
        return None
    pipe = _get_pipe("image")
    pipe.set_system(system)
    out = pipe.process(_to_bgr(image_rgb))
    return cv2.cvtColor(out, cv2.COLOR_BGR2RGB)


def process_video_upload(video_path: str, system: str):
    if not video_path:
        return None
    pipe = _get_pipe("video")
    pipe.set_system(system)
    out_path = os.path.join(tempfile.gettempdir(), f"langer_out_{os.getpid()}.mp4")
    process_video(video_path, out_path, pipe.process)
    return out_path


def build_ui():
    import gradio as gr

    with gr.Blocks(title="朗格线 / RSTL 面部投射") as demo:
        gr.Markdown("# 朗格线 / RSTL 面部投射")
        gr.Markdown(DISCLAIMER)
        system = gr.Radio(VALID_SYSTEMS, value="rstl",
                          label="线系统（rstl=Borges 松弛皮肤张力线，面部首选）")

        with gr.Tab("照片"):
            with gr.Row():
                img_in = gr.Image(label="上传照片", type="numpy")
                img_out = gr.Image(label="叠加结果")
            gr.Button("处理").click(process_image, [img_in, system], img_out)

        with gr.Tab("视频"):
            with gr.Row():
                vid_in = gr.Video(label="上传视频")
                vid_out = gr.Video(label="叠加结果")
            gr.Button("处理").click(process_video_upload, [vid_in, system], vid_out)

    return demo


def main() -> int:
    configure_logging()
    build_ui().launch()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
