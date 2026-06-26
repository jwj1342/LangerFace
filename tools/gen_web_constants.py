"""从 src/langerface/config/constants.py 生成 web/src/services/constantsGenerated.ts（跨语言单一真源，#30）。

核心几何标量/索引此前在 Python 与 web 各写一遍字面量，靠人记得同步、CI 抓不到漂移。
本脚本把 constants.py 作为唯一真源，生成 web 端可 import 的 TypeScript 常量文件：

  python tools/gen_web_constants.py

CI 会重新生成并对生成物 `git diff --exit-code`，constants.py 改了却没重跑本脚本即报错。
输出格式固定、可重复（用 json.dumps 稳定序列化数值），保证 diff 是确定性的。
"""
from __future__ import annotations

import json
import os

from langerface.config import constants as C

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "web", "src", "services", "constantsGenerated.ts")

# (JS 名, Python 值)。这些是 Python↔JS 共享的标量/索引，唯一真源在 constants.py。
SCALARS = [
    ("NOSE_TIP", C.NOSE_TIP),
    ("DEFAULT_OCCLUSION_THRESHOLD", C.DEFAULT_OCCLUSION_THRESHOLD),
    ("ONEEURO_MIN_CUTOFF", C.ONEEURO_MIN_CUTOFF),
    ("ONEEURO_BETA", C.ONEEURO_BETA),
    ("ONEEURO_DCUTOFF", C.ONEEURO_DCUTOFF),
    ("DEFAULT_FADE_FRAMES", C.DEFAULT_FADE_FRAMES),
    ("ATLAS_VERSION", C.ATLAS_VERSION),
    ("TOPOLOGY_ID", C.TOPOLOGY_ID),
    ("TOPOLOGY_VERSION", C.TOPOLOGY_VERSION),
]
# 数组类常量转为 list 以稳定序列化（INNER_LIP 取 sorted 保证顺序确定）。
ARRAYS = [
    ("INNER_LIP", sorted(C.INNER_LIP)),
    ("RIGID3D", list(C.RIGID3D)),
]

HEADER = (
    "// AUTO-GENERATED from src/langerface/config/constants.py "
    "by tools/gen_web_constants.py —— 勿手改。\n"
    "// 跨语言单一真源（#30）：改 constants.py 后运行 "
    "`python tools/gen_web_constants.py` 重新生成；CI 校验二者一致。\n\n"
)


def render() -> str:
    lines = [HEADER]
    for name, val in SCALARS + ARRAYS:
        lines.append(f"export const {name} = {json.dumps(val)};\n")
    return "".join(lines)


def main() -> int:
    content = render()
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"[ok] 生成 {os.path.relpath(OUT, REPO)}（{len(SCALARS) + len(ARRAYS)} 个共享常量）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
