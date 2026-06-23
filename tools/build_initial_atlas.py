"""生成首版（示意性）RSTL 与 Langer 面部线图谱 -> assets/atlas_*.json。

线条在“人脸归一化框” [0,1]^2 中按解剖方向定义（x: 0..1 横跨两颊；y: 0=前额顶(lm10)，1=下巴(lm152)），
再投影到标准网格三角面，编码为 (tri, u, v)。

⚠️ 医学声明：此为**示意性首版**，几何为近似，方向遵循 Borges RSTL 的总体走向。
   Langer 集合在文献指出与 RSTL 分歧的区域（鼻背、眦外、颏部、颞部）做了方向区分。
   两者均 validated=false，必须由临床医生用 tools/annotate_atlas.py 校验、修正后方可参考。
"""
from __future__ import annotations

import numpy as np

from langerface.config import ATLAS_PATHS, CANONICAL_OBJ, SYSTEM_LANGER, SYSTEM_RSTL  # noqa: E402
from langerface.geometry import CanonicalFaceModel  # noqa: E402
from langerface.lines import Atlas, atlas_line_from_points2d  # noqa: E402


# ── 归一化空间曲线生成器（返回 (n,2) 的 [0,1]^2 点）──────────────────────────────
def hline(ny, x0, x1, bow=0.0, n=36):
    t = np.linspace(0, 1, n)
    return np.column_stack([x0 + (x1 - x0) * t, ny + bow * (2 * t - 1) ** 2])


def vline(nx, y0, y1, bow=0.0, n=24):
    t = np.linspace(0, 1, n)
    return np.column_stack([nx + bow * (2 * t - 1) ** 2, y0 + (y1 - y0) * t])


def oblique(x0, y0, x1, y1, bow=0.0, n=28):
    t = np.linspace(0, 1, n)
    x = x0 + (x1 - x0) * t
    y = y0 + (y1 - y0) * t
    dx, dy = x1 - x0, y1 - y0
    L = np.hypot(dx, dy) + 1e-9
    off = bow * np.sin(np.pi * t)
    return np.column_stack([x - dy / L * off, y + dx / L * off])


def arc(cx, cy, rx, ry, a0, a1, n=28):
    a = np.linspace(np.radians(a0), np.radians(a1), n)
    return np.column_stack([cx + rx * np.cos(a), cy + ry * np.sin(a)])


def mirror(pts):
    """关于 nx=0.5 镜像到对侧。"""
    out = pts.copy()
    out[:, 0] = 1.0 - out[:, 0]
    return out


# ── RSTL（Borges 走向）──────────────────────────────────────────────────────────
def rstl_lines():
    L = []

    def add(name, region, pts):
        L.append((name, region, pts))

    # 前额：水平
    for i, ny in enumerate((0.05, 0.11, 0.17)):
        add(f"forehead_h{i}", "forehead", hline(ny, 0.20, 0.80, bow=0.025))
    # 眉间：竖直短线
    add("glabella_l", "glabella", vline(0.46, 0.19, 0.30))
    add("glabella_r", "glabella", vline(0.54, 0.19, 0.30))
    # 眼周（左侧，subject）：下睑弧 + 鱼尾纹放射
    periorbital = arc(0.355, 0.345, 0.085, 0.05, 200, 340)
    add("periorbital_l", "periorbital", periorbital)
    add("periorbital_r", "periorbital", mirror(periorbital))
    for k, (ex, ey) in enumerate([(0.235, 0.305), (0.225, 0.345), (0.235, 0.385)]):
        cf = oblique(0.285, 0.345, ex, ey)
        add(f"crowsfeet_l{k}", "periorbital", cf)
        add(f"crowsfeet_r{k}", "periorbital", mirror(cf))
    # 鼻：鼻背下段横向 + 鼻翼弧
    add("nose_dorsum", "nose", hline(0.46, 0.455, 0.545))
    ala = arc(0.45, 0.50, 0.035, 0.03, 60, 300)
    add("ala_l", "nose", ala)
    add("ala_r", "nose", mirror(ala))
    # 颊（左侧）：上外→下内 平行斜线（朝鼻唇沟）
    for k, x0 in enumerate((0.16, 0.21, 0.26)):
        ob = oblique(x0, 0.47, x0 + 0.16, 0.63, bow=0.01)
        add(f"cheek_l{k}", "cheek", ob)
        add(f"cheek_r{k}", "cheek", mirror(ob))
    # 鼻唇沟
    nlf = oblique(0.445, 0.50, 0.40, 0.66, bow=0.02)
    add("nasolabial_l", "perioral", nlf)
    add("nasolabial_r", "perioral", mirror(nlf))
    # 口周：唇放射状竖线
    for k, nx in enumerate((0.44, 0.48, 0.52, 0.56)):
        add(f"perioral_up_{k}", "perioral", vline(nx, 0.595, 0.64))
    for k, nx in enumerate((0.45, 0.50, 0.55)):
        add(f"perioral_lo_{k}", "perioral", vline(nx, 0.70, 0.745))
    # 颏部：水平弧
    add("chin_h0", "chin", hline(0.84, 0.42, 0.58, bow=0.012))
    add("chin_h1", "chin", hline(0.91, 0.45, 0.55, bow=0.012))
    return L


# ── Langer（在分歧区域做方向区分；其余与 RSTL 总体一致）─────────────────────────
def langer_lines():
    L = []

    def add(name, region, pts):
        L.append((name, region, pts))

    for i, ny in enumerate((0.05, 0.11, 0.17)):
        add(f"forehead_h{i}", "forehead", hline(ny, 0.20, 0.80, bow=0.02))
    # 眉间：仍竖直
    add("glabella_l", "glabella", vline(0.46, 0.19, 0.30))
    add("glabella_r", "glabella", vline(0.54, 0.19, 0.30))
    # 眦外（分歧）：竖向短线，而非放射
    for k, nx in enumerate((0.225, 0.255)):
        vl = vline(nx, 0.30, 0.40)
        add(f"lat_canthus_l{k}", "periorbital", vl)
        add(f"lat_canthus_r{k}", "periorbital", mirror(vl))
    periorbital = arc(0.355, 0.345, 0.085, 0.05, 200, 340)
    add("periorbital_l", "periorbital", periorbital)
    add("periorbital_r", "periorbital", mirror(periorbital))
    # 鼻背（分歧）：竖向，而非横向
    add("nose_dorsum", "nose", vline(0.50, 0.40, 0.50))
    ala = arc(0.45, 0.50, 0.035, 0.03, 60, 300)
    add("ala_l", "nose", ala)
    add("ala_r", "nose", mirror(ala))
    # 颊（分歧）：更陡（偏竖直）
    for k, x0 in enumerate((0.20, 0.25, 0.30)):
        ob = oblique(x0, 0.46, x0 + 0.06, 0.64, bow=0.005)
        add(f"cheek_l{k}", "cheek", ob)
        add(f"cheek_r{k}", "cheek", mirror(ob))
    # 口周：仍放射状
    for k, nx in enumerate((0.44, 0.48, 0.52, 0.56)):
        add(f"perioral_up_{k}", "perioral", vline(nx, 0.595, 0.64))
    for k, nx in enumerate((0.45, 0.50, 0.55)):
        add(f"perioral_lo_{k}", "perioral", vline(nx, 0.70, 0.745))
    # 颏部（分歧）：竖向
    for k, nx in enumerate((0.47, 0.53)):
        add(f"chin_v{k}", "chin", vline(nx, 0.80, 0.93))
    return L


# ── 转换：归一化曲线 → 图谱 (tri, u, v) ─────────────────────────────────────────
def build_atlas(system, line_defs, canonical, provenance):
    proj = canonical.project_front()
    atlas = Atlas(system=system, version="0.1", provenance=provenance, validated=False)
    for name, region, norm_pts in line_defs:
        world = canonical.norm_to_proj(norm_pts)
        atlas.lines.append(atlas_line_from_points2d(canonical, name, region, world, proj=proj))
    return atlas


def main() -> int:
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    prov = ("示意性首版：方向遵循 Borges RSTL 走向，几何为近似；Langer 在文献分歧区做方向区分。"
            "必须经临床医生用 tools/annotate_atlas.py 校验后方可参考。")
    specs = [
        (SYSTEM_RSTL, rstl_lines(), prov),
        (SYSTEM_LANGER, langer_lines(), prov),
    ]
    for system, defs, p in specs:
        atlas = build_atlas(system, defs, canonical, p)
        issues = atlas.validate(len(canonical.triangles))
        if issues:
            print(f"[warn] {system} 校验问题：{issues}")
        atlas.save(ATLAS_PATHS[system])
        print(f"[ok] {system}: {len(atlas.lines)} 条线 -> {ATLAS_PATHS[system]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
