"""资产路径解析（与配置数据分离）。

资产（标准脸 .obj、关键点 .task、图谱 JSON）位于仓库根的 ``assets/``。
默认按包位置推导仓库根；可用环境变量 ``LANGERFACE_ASSETS_DIR`` 覆盖
（便于 CI、容器或资产另置）。``require_asset`` 统一“缺资产”的报错文案。
"""
from __future__ import annotations

import os

from .constants import SYSTEM_LANGER, SYSTEM_RSTL

# src/langerface/config/assets.py -> 上溯 4 层到仓库根（src 布局）。
_PACKAGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../src/langerface
_REPO_DIR = os.path.dirname(os.path.dirname(_PACKAGE_DIR))                  # repo root


def assets_dir() -> str:
    """返回资产目录，允许 LANGERFACE_ASSETS_DIR 覆盖。"""
    return os.environ.get("LANGERFACE_ASSETS_DIR", os.path.join(_REPO_DIR, "assets"))


ASSETS_DIR = assets_dir()
CANONICAL_OBJ = os.path.join(ASSETS_DIR, "canonical_face_model.obj")
FACE_LANDMARKER_TASK = os.path.join(ASSETS_DIR, "face_landmarker.task")
ATLAS_PATHS = {
    SYSTEM_RSTL: os.path.join(ASSETS_DIR, "atlas_rstl.json"),
    SYSTEM_LANGER: os.path.join(ASSETS_DIR, "atlas_langer.json"),
}


def require_asset(path: str, what: str = "资产") -> str:
    """资产存在则返回其路径，否则抛出带修复指引的 FileNotFoundError。"""
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"找不到{what} {path}。\n"
            f"请先运行  python tools/download_assets.py  下载资产，"
            f"并运行  python tools/build_field_atlas.py  生成图谱。"
        )
    return path
