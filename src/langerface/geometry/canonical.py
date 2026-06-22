"""标准脸模型 (MediaPipe canonical_face_model.obj)。

提供：
- 468 个标准顶点、三角拓扑、UV（从 .obj 解析）
- 正面正交投影（用于图谱标注/构建的 2D 工作空间）
- 点定位：给定 2D 点 → (三角面 id, 重心坐标)

顶点顺序与 MediaPipe Face Landmarker 的关键点索引 0..467 一一对应，
因此从 .obj 得到的三角面可直接用于运行时检测到的关键点。
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..config.assets import require_asset
from ..config.constants import FACE_FRAME_ANCHORS
from .barycentric import barycentric_batch


@dataclass
class CanonicalFaceModel:
    vertices: np.ndarray   # (468, 3) 标准空间坐标（厘米；x 右, y 上, z 朝向观察者）
    triangles: np.ndarray  # (M, 3) int，索引进 vertices / 关键点
    uv: np.ndarray | None  # (468, 2) 或 None

    # ── 解析 .obj ────────────────────────────────────────────────────────────
    @classmethod
    def from_obj(cls, path: str) -> "CanonicalFaceModel":
        require_asset(path, what="标准脸模型")
        verts: list[tuple[float, float, float]] = []
        texs: list[tuple[float, float]] = []
        faces: list[tuple[int, int, int]] = []
        vt_of_v: dict[int, int] = {}  # 顶点 -> 对应的 vt 索引（取首次出现）

        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("v "):
                    _, x, y, z = line.split()[:4]
                    verts.append((float(x), float(y), float(z)))
                elif line.startswith("vt "):
                    parts = line.split()
                    texs.append((float(parts[1]), float(parts[2])))
                elif line.startswith("f "):
                    idx = _parse_face(line)
                    # 三角化（标准模型本就是三角面，这里兜底处理多边形扇形剖分）
                    for a, b, c in _fan(idx):
                        faces.append((a[0], b[0], c[0]))
                        for vi, vti in (a, b, c):
                            if vti is not None and vi not in vt_of_v:
                                vt_of_v[vi] = vti

        vertices = np.asarray(verts, dtype=np.float64)
        triangles = np.asarray(faces, dtype=np.int64)

        uv = None
        if texs and vt_of_v:
            uv = np.zeros((len(verts), 2), dtype=np.float64)
            tex_arr = np.asarray(texs, dtype=np.float64)
            for vi, vti in vt_of_v.items():
                uv[vi] = tex_arr[vti]

        n = len(verts)
        if triangles.size and triangles.max() >= n:
            raise ValueError("三角面索引越界，.obj 解析异常")
        return cls(vertices=vertices, triangles=triangles, uv=uv)

    # ── 正面投影（图谱构建/标注的 2D 工作空间）────────────────────────────────
    def project_front(self) -> np.ndarray:
        """正交投影到 2D：x 不变（右），y 取反（图像 y 向下）。返回 (468, 2)。

        未做归一化，单位仍为标准模型单位；图谱构建用 face_frame() 归一化到人脸框。
        """
        pts = np.column_stack([self.vertices[:, 0], -self.vertices[:, 1]])
        return pts

    def face_frame(self) -> tuple[np.ndarray, np.ndarray]:
        """人脸归一化框：用稳定的解剖锚点定义 [0,1]^2 坐标系，与全网格范围无关。

        锚点（config.constants.FACE_FRAME_ANCHORS）：上=10 下=152 左/右=234/454。
        返回 (origin(2,), size(2,))，使  norm = (proj - origin) / size。
        """
        proj = self.project_front()
        top, bottom = proj[FACE_FRAME_ANCHORS["top"]], proj[FACE_FRAME_ANCHORS["bottom"]]
        left, right = proj[FACE_FRAME_ANCHORS["left"]], proj[FACE_FRAME_ANCHORS["right"]]
        x0, x1 = sorted((left[0], right[0]))
        y0, y1 = top[1], bottom[1]  # 顶在上（y 较小），底在下
        origin = np.array([x0, y0])
        size = np.array([x1 - x0, y1 - y0])
        return origin, size

    def norm_to_proj(self, norm_pts: np.ndarray) -> np.ndarray:
        """人脸归一化坐标 [0,1]^2 → 正面投影坐标。"""
        origin, size = self.face_frame()
        return np.asarray(norm_pts, dtype=np.float64) * size + origin

    # ── 点定位：2D 点 → (三角面, 重心坐标) ─────────────────────────────────────
    def locate(self, point2d: np.ndarray, proj: np.ndarray | None = None) -> tuple[int, np.ndarray]:
        """在正面投影中找到包含 point2d 的三角面，返回 (tri_index, bary(3,))。

        若点落在所有三角面之外，则返回最近三角面并把重心坐标裁剪到单纯形内。
        仅用于图谱构建（离线），暴力遍历即可。
        """
        if proj is None:
            proj = self.project_front()
        p = np.asarray(point2d, dtype=np.float64)
        tris = self.triangles
        a = proj[tris[:, 0]]
        b = proj[tris[:, 1]]
        c = proj[tris[:, 2]]
        bary = barycentric_batch(p, a, b, c)             # (M, 3)
        # 正交投影会让正面与后脑的三角面在 2D 重叠；优先选最靠近观察者（z 最大）的，
        # 避免把面部线点错配到后脑三角面（否则运行时会被背面剔除/错位）。
        tri_z = self.vertices[tris, 2].mean(axis=1)      # (M,) 三角面平均深度
        inside = np.all(bary >= -1e-9, axis=1)
        if np.any(inside):
            cand = np.where(inside)[0]
            best = cand[np.argmax(tri_z[cand])]          # 取最靠前的包含三角面
            return int(best), bary[best]
        # 退化：点落在所有三角面之外——综合“最不越界”与“靠前”打分
        score = np.min(bary, axis=1) + 0.01 * (tri_z - tri_z.min()) / (np.ptp(tri_z) + 1e-9)
        best = int(np.argmax(score))
        bb = np.clip(bary[best], 0.0, None)
        s = bb.sum()
        bb = bb / s if s > 0 else np.array([1 / 3, 1 / 3, 1 / 3])
        return best, bb


# ── 几何辅助 ──────────────────────────────────────────────────────────────────
def _parse_face(line: str):
    out = []
    for tok in line.split()[1:]:
        sub = tok.split("/")
        v = int(sub[0]) - 1
        vt = int(sub[1]) - 1 if len(sub) > 1 and sub[1] else None
        out.append((v, vt))
    return out


def _fan(idx):
    for i in range(1, len(idx) - 1):
        yield idx[0], idx[i], idx[i + 1]
