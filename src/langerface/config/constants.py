"""集中的标量常量与 MediaPipe 关键点索引（单一事实来源）。

这里只放**纯标量 / 元组**，不依赖任何类，避免与 settings.py 形成循环导入。
原先散落在 occlusion.py、canonical.py、各 tools 脚本里的“魔法数”统一收敛到此处。
"""
from __future__ import annotations

# ── 线系统标识 ────────────────────────────────────────────────────────────────
SYSTEM_RSTL = "rstl"      # Borges 松弛皮肤张力线（面部手术首选，默认）
SYSTEM_LANGER = "langer"  # 经典 Langer 裂线
VALID_SYSTEMS = (SYSTEM_RSTL, SYSTEM_LANGER)

# 当前运行时消费的 atlas JSON 契约版本。旧版生成器仍可离线读取，
# 但正式 LinePipeline 加载边界必须拒绝版本漂移的图谱。
ATLAS_VERSION = "0.2"

# ── MediaPipe 关键点索引（Face Landmarker 478 点约定，索引稳定）────────────────
NOSE_TIP = 1  # 鼻尖：背面剔除每帧符号标定的参考点

# 人脸归一化框锚点：上=前额顶 下=下巴 左/右=两颊缘（canonical.face_frame 使用）
FACE_FRAME_ANCHORS = {"top": 10, "bottom": 152, "left": 234, "right": 454}

# ── 稳定性默认值 ──────────────────────────────────────────────────────────────
DEFAULT_OCCLUSION_THRESHOLD = -0.05  # 背面剔除朝向打分阈值（略小于 0，保留掠射边缘）

# One-Euro 时间平滑默认参数（settings.Config 与 detection.smoothing 共用，避免重复定义）
ONEEURO_MIN_CUTOFF = 1.5
ONEEURO_BETA = 0.05
ONEEURO_DCUTOFF = 1.0

DEFAULT_FADE_FRAMES = 6  # 丢脸淡出 / 重检测淡入帧数
