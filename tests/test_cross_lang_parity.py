"""跨语言对拍（live Python 侧）：保证 Python == Web TypeScript == 金标三方一致。

CI 的唯一跨语言护栏是 tools/test_web_mapping.ts（Web TypeScript 对 web/test/expected.json 金标），
但 CI 从不重跑 Python，故单边的 Python 改动会从 CI 旁漏过去——这正是 #28。

本测试在 Python 侧用**金标里已嵌入的关键点**重算 pts/vis，断言：
  * pts 与金标在 1e-2 px 内一致；
  * vis 与金标**逐位精确**相等（含 #38 口裂三角面排除）；
  * One-Euro 夹具：LandmarkSmoother(input) == 金标 expected（紧公差）。

更新金标见 docs/CROSS_LANG_PARITY.md（一键纯重算，无 mediapipe / 无私有素材）。
"""
from __future__ import annotations

import json
import os

import numpy as np
import pytest

from langerface.config import ATLAS_PATHS, CANONICAL_OBJ
from langerface.config.constants import inner_mouth_triangles
from langerface.detection import LandmarkSmoother
from langerface.geometry import CanonicalFaceModel
from langerface.lines import Atlas, map_atlas
from langerface.rendering import BackfaceCuller

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPECTED = os.path.join(REPO, "web", "test", "expected.json")
WEB_ATLAS = os.path.join(REPO, "web", "assets", "atlas_rstl.json")
WEB_TRIANGLES = os.path.join(REPO, "web", "assets", "triangles.json")

PTS_TOL = 1e-2  # px


@pytest.fixture(scope="module")
def golden():
    with open(EXPECTED, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def web_triangles():
    with open(WEB_TRIANGLES, encoding="utf-8") as f:
        return np.asarray(json.load(f), dtype=np.int64)


def test_web_assets_match_src_copies(web_triangles):
    """web/assets 的 triangles / atlas 必须与 src 同一事实来源逐字一致，
    否则 Python 重算用的拓扑/图谱会与 Web TypeScript 用的漂移，对拍失效。"""
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    assert np.array_equal(canonical.triangles, web_triangles)

    with open(WEB_ATLAS, encoding="utf-8") as f:
        web_atlas = json.load(f)
    with open(ATLAS_PATHS["rstl"], encoding="utf-8") as f:
        src_atlas = json.load(f)
    assert web_atlas == src_atlas


def test_pts_and_vis_match_golden(golden, web_triangles):
    """逐帧：从金标里的关键点重算 pts/vis，断言 pts 在 1e-2 px 内、vis 逐位精确相等。"""
    atlas = Atlas.load(WEB_ATLAS)
    culler = BackfaceCuller(web_triangles)

    assert golden["frames"], "金标无帧"
    for fr in golden["frames"]:
        lm = np.asarray(fr["landmarks"], dtype=np.float64)
        mapped = map_atlas(atlas, lm, web_triangles)
        vis_tri = culler.visible_triangles(lm)
        assert len(mapped) == len(fr["lines"]), f"frame {fr['idx']} 线数不一致"
        for ml, gl in zip(mapped, fr["lines"]):
            assert ml.name == gl["name"]
            got = np.asarray(ml.pts, dtype=np.float64)
            exp = np.asarray(gl["pts"], dtype=np.float64)
            assert got.shape == exp.shape
            assert np.max(np.abs(got - exp)) <= PTS_TOL, f"frame {fr['idx']} 线 {gl['name']} pts 超差"
            got_vis = vis_tri[ml.tris].astype(int).tolist()
            assert got_vis == gl["vis"], f"frame {fr['idx']} 线 {gl['name']} vis 不一致"


def test_vis_includes_inner_mouth_exclusion(golden, web_triangles):
    """护栏：金标里至少有一处 #38 口裂三角面被排除（否则掩膜悄悄失效也不会被发现）。"""
    inner = inner_mouth_triangles(web_triangles)
    assert inner, "拓扑里居然没有口裂三角面，夹具/拓扑可能漂移"

    atlas = Atlas.load(WEB_ATLAS)
    excluded_any = False
    for fr in golden["frames"]:
        for ln in atlas.lines:
            for tri, gvis in _iter_line_vis(fr, ln):
                if tri in inner and gvis == 0:
                    excluded_any = True
    assert excluded_any, "金标里没有任何口裂三角面被排除——掩膜可能未生效"


def _iter_line_vis(frame, atlas_line):
    """把一条 atlas 线的每点三角面 id 与金标对应 vis 配对。"""
    tris = atlas_line.points[:, 0].astype(int)
    gl = next((x for x in frame["lines"] if x["name"] == atlas_line.name), None)
    if gl is None:
        return
    yield from zip(tris.tolist(), gl["vis"])


def test_one_euro_fixture_matches_golden(golden):
    """One-Euro 夹具：LandmarkSmoother(input, t) 必须逐位重现金标 expected。
    Web TypeScript OneEuro 用同一夹具断言（tools/test_web_mapping.ts）→ Python==Web TypeScript==金标。"""
    fix = golden["oneEuro"]
    sm = LandmarkSmoother(
        min_cutoff=fix["minCutoff"], beta=fix["beta"], dcutoff=fix["dcutoff"],
    )
    for frame_in, t, exp in zip(fix["inputs"], fix["times"], fix["expected"]):
        out = sm.filter(np.asarray(frame_in, dtype=np.float64), t)
        np.testing.assert_allclose(out, np.asarray(exp, dtype=np.float64), atol=1e-12, rtol=0)
