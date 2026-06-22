"""共享测试夹具与资产门控（消除各测试文件重复的加载/跳过逻辑）。

测试依赖已安装的 langerface（`pip install -e .`）。若未安装，这里把 src/ 兜底
加入 sys.path，方便本地直接 `pytest`。
"""
import os
import sys
from pathlib import Path

import numpy as np
import pytest

try:
    import langerface  # noqa: F401
except ImportError:  # 测试兜底：未安装时直接用源码树
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from langerface.config import ATLAS_PATHS, CANONICAL_OBJ, SYSTEM_RSTL  # noqa: E402

CANONICAL_AVAILABLE = os.path.exists(CANONICAL_OBJ)
RSTL_ATLAS_AVAILABLE = os.path.exists(ATLAS_PATHS[SYSTEM_RSTL])

requires_canonical = pytest.mark.skipif(
    not CANONICAL_AVAILABLE,
    reason="需先下载 canonical_face_model.obj（python tools/download_assets.py）",
)
requires_rstl_atlas = pytest.mark.skipif(
    not (CANONICAL_AVAILABLE and RSTL_ATLAS_AVAILABLE),
    reason="需先生成 RSTL 图谱（python tools/build_field_atlas.py）",
)


@pytest.fixture(scope="session")
def canonical():
    if not CANONICAL_AVAILABLE:
        pytest.skip("canonical_face_model.obj 缺失")
    from langerface.geometry import CanonicalFaceModel
    return CanonicalFaceModel.from_obj(CANONICAL_OBJ)


@pytest.fixture(scope="session")
def rstl_atlas():
    if not RSTL_ATLAS_AVAILABLE:
        pytest.skip("RSTL 图谱缺失")
    from langerface.lines import Atlas
    return Atlas.load(ATLAS_PATHS[SYSTEM_RSTL])


@pytest.fixture
def synthetic_landmarks(canonical):
    """工厂夹具：把标准脸正面投影缩放进图像，构成 (468,3) 伪关键点 + (w,h)。

    用于确定性的端到端渲染测试（不依赖 MediaPipe / 真实照片）。
    """
    def _make(w: int = 600, h: int = 800, pad: int = 80):
        proj = canonical.project_front()
        mn, mx = proj.min(0), proj.max(0)
        span = mx - mn
        scale = min((w - 2 * pad) / span[0], (h - 2 * pad) / span[1])
        xy = (proj - mn) * scale + pad
        z = canonical.vertices[:, 2] * scale
        return np.column_stack([xy, z]), (w, h)

    return _make
