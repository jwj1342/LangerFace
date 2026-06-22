"""LangerFace — 面部朗格线 / RSTL 投射系统 (Facial Langer / RSTL line projection).

把皮肤张力线（RSTL / Langer 线）稳定地叠加到人脸照片、视频或实时摄像头画面上，
作为面部手术切口规划的**决策辅助可视化**。

架构分层（每层一个职责，便于多人协作与 Stage 2 扩展）：
    config/      集中配置、常量、资产路径
    geometry/    与领域无关的几何（标准脸、重心坐标、刚性对齐）
    detection/   关键点检测契约 + MediaPipe 实现 + 时间平滑
    lines/       Stage 1：朗格/RSTL 线图谱（数据模型、映射、构建）
    rendering/   叠加渲染、遮挡剔除
    pipeline/    高层编排（检测→平滑→映射→剔除→渲染）
    media/       视频 I/O 与逐帧处理工具
    apps/        命令行 / 摄像头入口（瘦壳）

Stage 2（计划中）将以同级子包 tumor/、incision/ 接入，复用 geometry/detection/rendering。

医学声明：本系统是可视化辅助工具，不是手术指令，也不是受监管的医疗器械。
内置线条图谱为示意性首版，必须经临床医生校验后方可参考。详见 README《已知局限与医学声明》。
"""
from __future__ import annotations

__version__ = "0.2.0"

# 稳定的顶层公共 API —— 子包内部的文件组织对调用方隐藏。
from .config import (  # noqa: E402
    SYSTEM_LANGER,
    SYSTEM_RSTL,
    VALID_SYSTEMS,
    Config,
    LineStyle,
    build_config,
)

__all__ = [
    "__version__",
    "Config",
    "LineStyle",
    "SYSTEM_RSTL",
    "SYSTEM_LANGER",
    "VALID_SYSTEMS",
    "build_config",
]
