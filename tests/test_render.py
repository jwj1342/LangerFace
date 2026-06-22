"""端到端渲染（确定性，不需 MediaPipe / 真实照片）。

用标准脸投影当作“检测到的关键点”，映射图谱并渲染，断言确有线条像素被画出，
且背面剔除会减少可见线条像素。需先下载 obj 并运行 build_field_atlas.py。
"""
import numpy as np

from langerface.config import DEFAULT_STYLES, SYSTEM_RSTL
from langerface.lines import map_atlas
from langerface.rendering import BackfaceCuller, draw_overlay

from .conftest import requires_rstl_atlas


@requires_rstl_atlas
def test_overlay_draws_lines(canonical, rstl_atlas, synthetic_landmarks):
    lm, (w, h) = synthetic_landmarks()
    mapped = map_atlas(rstl_atlas, lm, canonical.triangles)
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
