"""资产一致性门禁（#47）：web/assets/ 的派生物必须与 assets/ 权威源逐字节一致。

assets/ 是唯一权威源，web/assets/ 由 tools/export_web_assets.py 派生。本测试杜绝
「改了图谱只跑 build_field_atlas.py、忘了 export_web_assets.py → 部署旧 atlas」这一
#47 描述的静默漂移：atlas_*.json 在两处都随仓库提交，CI 即可比对。

gitignored 的大模型（*.task）在干净/CI 环境缺席，源不存在时跳过。
"""
import filecmp
import os

import pytest

from langerface.config import ATLAS_PATHS

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_WEB_ASSETS = os.path.join(_REPO, "web", "assets")


@pytest.mark.parametrize("system", list(ATLAS_PATHS))
def test_web_atlas_matches_source(system):
    src = ATLAS_PATHS[system]
    if not os.path.exists(src):
        pytest.skip(f"{system} 源图谱未生成（先跑 build_field_atlas.py）")
    name = os.path.basename(src)
    dst = os.path.join(_WEB_ASSETS, name)
    assert os.path.exists(dst), f"web/assets/{name} 缺失——请运行 tools/export_web_assets.py 同步"
    assert filecmp.cmp(src, dst, shallow=False), (
        f"{system} 图谱在 assets/ 与 web/assets/ 不一致——"
        "改了图谱后请重新运行 tools/export_web_assets.py 把 assets/ 同步到 web/assets/"
    )
