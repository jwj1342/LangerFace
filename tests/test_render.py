"""端到端渲染（确定性，不需 MediaPipe / 真实照片）。

用标准脸投影当作“检测到的关键点”，映射图谱并渲染，断言确有线条像素被画出，
且背面剔除会减少可见线条像素。需先下载 obj 并生成图谱。
"""
import os

import numpy as np
import pytest

from langerlines.config import CANONICAL_OBJ, ATLAS_PATHS, SYSTEM_RSTL, DEFAULT_STYLES

pytestmark = pytest.mark.skipif(
    not os.path.exists(CANONICAL_OBJ) or not os.path.exists(ATLAS_PATHS[SYSTEM_RSTL]),
    reason="需先下载 obj 并运行 build_initial_atlas.py",
)


def _synthetic_landmarks(canonical, w=600, h=800, pad=80):
    """把标准脸正面投影缩放进图像，z 取标准 z，构成 (468,3) 伪关键点。"""
    proj = canonical.project_front()
    mn, mx = proj.min(0), proj.max(0)
    span = (mx - mn)
    scale = min((w - 2 * pad) / span[0], (h - 2 * pad) / span[1])
    xy = (proj - mn) * scale + pad
    z = canonical.vertices[:, 2] * scale
    return np.column_stack([xy, z]), (w, h)


def test_overlay_draws_lines():
    from langerlines.canonical import CanonicalFaceModel
    from langerlines.atlas import Atlas
    from langerlines.mapping import map_atlas
    from langerlines.occlusion import BackfaceCuller
    from langerlines.render import draw_overlay

    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    lm, (w, h) = _synthetic_landmarks(canonical)
    atlas = Atlas.load(ATLAS_PATHS[SYSTEM_RSTL])
    mapped = map_atlas(atlas, lm, canonical.triangles)
    style = DEFAULT_STYLES[SYSTEM_RSTL]

    blank = np.zeros((h, w, 3), dtype=np.uint8)
    full = draw_overlay(blank, mapped, None, style, global_alpha=1.0)
    painted_full = int(np.count_nonzero(full.any(axis=2)))
    assert painted_full > 200, "几乎没有线条被画出"

    culler = BackfaceCuller(canonical.triangles)
    vis = culler.visible_triangles(lm)
    culled = draw_overlay(blank, mapped, vis, style, global_alpha=1.0)
    painted_culled = int(np.count_nonzero(culled.any(axis=2)))
    # 正面视图下大部分线条应可见（剔除不应抹掉绝大多数）
    assert painted_culled > 0.5 * painted_full
