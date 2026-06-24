"""生成**稠密方向场**图谱：布满整张脸的细密张力线流线 -> assets/atlas_*.json。

做法（比稀疏示意图更科学、更"震撼"）：
1. 在"人脸归一化框"上定义张力线**方向场** θ(x,y)（按 Borges RSTL 各区走向：前额横、鼻/人中竖、
   眼周同心、口周放射、颊部斜行等），用方向向量(cos2θ,sin2θ)加权平均做平滑融合。
2. 在人脸区域内用 **Jobard–Lefèvre 等间距流线** 算法，沿方向场追踪大量均匀分布的细流线。
3. 流线裁剪在人脸内（椭圆掩膜，挖去眼/口），逐点投影到网格三角面，编码为 (tri,u,v)。

⚠️ 仍为**示意性首版**（validated=false）：方向场遵循 RSTL 总体走向，几何为近似，
   必须经临床医生用 annotate_atlas.py 校验。Langer 变体在分歧区做方向区分，仅作对照。

  python3 tools/build_field_atlas.py [d_sep]      # d_sep 越小越密，默认 0.030
"""
from __future__ import annotations

import math
import sys

import numpy as np

from langerface.config import ATLAS_PATHS, CANONICAL_OBJ, SYSTEM_LANGER, SYSTEM_RSTL
from langerface.geometry import CanonicalFaceModel
from langerface.lines import Atlas, atlas_line_from_points2d


# ── 人脸掩膜（椭圆，挖去眼/口）──────────────────────────────────────────────────
class Mask:
    def __init__(self, eyeR, eyeL, mouth):
        # 椭圆略内收于轮廓，确保线条不会越出皮肤
        self.cx, self.cy, self.rx, self.ry = 0.5, 0.49, 0.455, 0.495
        self.holes = [
            (eyeR[0], eyeR[1], 0.085, 0.052),
            (eyeL[0], eyeL[1], 0.085, 0.052),
            (mouth[0], mouth[1], 0.105, 0.058),
        ]

    def inside(self, p):
        nx, ny = p
        if ((nx - self.cx) / self.rx) ** 2 + ((ny - self.cy) / self.ry) ** 2 > 1.0:
            return False
        for ex, ey, rx, ry in self.holes:
            if ((nx - ex) / rx) ** 2 + ((ny - ey) / ry) ** 2 < 1.0:
                return False
        return True


# ── 方向场 ───────────────────────────────────────────────────────────────────
def make_theta(eyeR, eyeL, mouth, variant):
    sig_eye, sig_mouth = 0.090, 0.095
    # Langer 在颊/鼻/颏与 RSTL 分歧：颊更竖、鼻背竖、口周仍放射
    cheek_l = math.radians(48 if variant == "rstl" else 80)
    cheek_r = math.radians(132 if variant == "rstl" else 100)

    def theta(p):
        nx, ny = p
        cx = nx - 0.5
        vx = 0.0
        vy = 0.0

        def add(angle, w):
            nonlocal vx, vy
            vx += w * math.cos(2 * angle)
            vy += w * math.sin(2 * angle)

        # 基础场（全部用高斯权重，保证平滑无突变）
        wh = math.exp(-((ny - 0.11) / 0.12) ** 2) + math.exp(-((ny - 0.89) / 0.10) ** 2)
        add(0.0, 1.15 * wh)                                         # 前额/颏 横向
        wv = math.exp(-(cx / 0.10) ** 2) * (0.9 if ny < 0.62 else 0.45)
        add(math.pi / 2, 1.7 * wv)                                  # 鼻梁/人中/眉间 竖向
        wc = math.exp(-((ny - 0.56) / 0.24) ** 2) * (1 - math.exp(-(cx / 0.14) ** 2))
        add(cheek_l if cx < 0 else cheek_r, 2.5 * wc)              # 颊部斜行
        if variant == "langer":
            add(math.pi / 2, 0.7 * math.exp(-((ny - 0.45) / 0.10) ** 2) * math.exp(-(cx / 0.06) ** 2))

        # 眼周：同心（切向）
        for E in (eyeR, eyeL):
            rx, ry = nx - E[0], ny - E[1]
            d2 = rx * rx + ry * ry
            w = 2.6 * math.exp(-d2 / (2 * sig_eye ** 2))
            add(math.atan2(ry, rx) + math.pi / 2, w)
        # 口周：放射（径向，垂直于唇）
        rx, ry = nx - mouth[0], ny - mouth[1]
        d2 = rx * rx + ry * ry
        w = 2.0 * math.exp(-d2 / (2 * sig_mouth ** 2))
        add(math.atan2(ry, rx), w)

        return 0.5 * math.atan2(vy, vx)

    return theta


# ── 空间哈希（等间距判定）──────────────────────────────────────────────────────
class SpatialHash:
    def __init__(self, cell):
        self.cell = cell
        self.d: dict = {}

    def _key(self, p):
        return (int(p[0] / self.cell), int(p[1] / self.cell))

    def add(self, p):
        self.d.setdefault(self._key(p), []).append(p)

    def too_close(self, p, dmin):
        kx, ky = self._key(p)
        dmin2 = dmin * dmin
        for i in range(kx - 1, kx + 2):
            for j in range(ky - 1, ky + 2):
                for q in self.d.get((i, j), ()):
                    dx, dy = p[0] - q[0], p[1] - q[1]
                    if dx * dx + dy * dy < dmin2:
                        return True
        return False


# ── 等间距流线放置（Jobard–Lefèvre）─────────────────────────────────────────────
def place_streamlines(theta, mask, d_sep, step=0.008, max_steps=320):
    d_test = 0.5 * d_sep
    hsh = SpatialHash(d_sep)
    lines = []
    seeds = [np.array([0.5, 0.42])]  # 起始种子

    def trace(seed, direction):
        pts = [np.array(seed, float)]
        p = np.array(seed, float)
        prev = None
        for _ in range(max_steps):
            ang = theta(p)
            d = np.array([math.cos(ang), math.sin(ang)]) * direction
            if prev is not None and np.dot(d, prev) < 0:
                d = -d
            # RK2
            mid = p + 0.5 * step * d
            if not mask.inside(mid):
                break
            ang2 = theta(mid)
            d2 = np.array([math.cos(ang2), math.sin(ang2)])
            if np.dot(d2, d) < 0:
                d2 = -d2
            nxt = p + step * d2
            if not mask.inside(nxt) or hsh.too_close(nxt, d_test):
                break
            pts.append(nxt)
            prev = d2
            p = nxt
        return pts

    while seeds:
        seed = seeds.pop()
        if not mask.inside(seed) or hsh.too_close(seed, d_test):
            continue
        fwd = trace(seed, +1)
        bwd = trace(seed, -1)
        line = list(reversed(bwd[1:])) + fwd
        if len(line) < 5:
            continue
        for q in line:
            hsh.add(q)
        lines.append(np.array(line))
        # 沿线在垂直方向播撒新种子
        for k in range(0, len(line), 4):
            if k + 1 >= len(line):
                continue
            t = line[k + 1] - line[k]
            n = np.array([-t[1], t[0]])
            nn = np.linalg.norm(n)
            if nn < 1e-9:
                continue
            n = n / nn
            for s in (1, -1):
                cand = line[k] + s * d_sep * n
                if mask.inside(cand) and not hsh.too_close(cand, d_sep):
                    seeds.append(cand)
    return lines


def norm_center(canonical, idx):
    proj = canonical.project_front()
    origin, size = canonical.face_frame()
    p = proj[idx].mean(axis=0)
    return (p - origin) / size


def build(canonical, variant, d_sep):
    eyeR = norm_center(canonical, [33, 133, 159, 145, 153, 158])
    eyeL = norm_center(canonical, [362, 263, 386, 374, 380, 385])
    mouth = norm_center(canonical, [13, 14, 61, 291, 0, 17])
    theta = make_theta(eyeR, eyeL, mouth, variant)
    mask = Mask(eyeR, eyeL, mouth)
    norm_lines = place_streamlines(theta, mask, d_sep)

    proj = canonical.project_front()
    atlas = Atlas(system=variant, version="0.2",
                  provenance=("稠密方向场（流线）首版：方向遵循 Borges RSTL 走向，几何近似；"
                              "Langer 在分歧区做方向区分。validated=false，须临床校验。"),
                  validated=False)
    for i, nl in enumerate(norm_lines):
        world = canonical.norm_to_proj(nl)
        atlas.lines.append(atlas_line_from_points2d(canonical, f"f{i}", variant, world, proj=proj))
    return atlas


def main():
    d_sep = float(sys.argv[1]) if len(sys.argv) > 1 else 0.030
    canonical = CanonicalFaceModel.from_obj(CANONICAL_OBJ)
    for variant in (SYSTEM_RSTL, SYSTEM_LANGER):
        atlas = build(canonical, variant, d_sep)
        npts = sum(len(line.points) for line in atlas.lines)
        issues = atlas.validate(len(canonical.triangles))
        if issues:
            print(f"[warn] {variant}: {issues[:3]}")
        atlas.save(ATLAS_PATHS[variant])
        print(f"[ok] {variant}: {len(atlas.lines)} 条流线 / {npts} 点 -> {ATLAS_PATHS[variant]}")


if __name__ == "__main__":
    main()
