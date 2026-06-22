"""线条图谱：在标准脸空间中定义的曲线集合。

存储格式（JSON）——每个线点编码为 (三角面 id, 重心坐标 u, v)，w = 1-u-v。
这样同一套三角拓扑在运行时检测到的人脸上存在，图谱即可随脸网格精确变形（AR 脸绘技术）。

{
  "system": "rstl",
  "version": "0.1",
  "provenance": "...",
  "validated": false,
  "lines": [
    {"name": "forehead_h1", "region": "forehead",
     "points": [[tri, u, v], [tri, u, v], ...]}
  ]
}
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field

import numpy as np


@dataclass
class AtlasLine:
    name: str
    region: str
    points: np.ndarray  # (N, 3) = [tri_index(float), u, v]

    def tris(self) -> np.ndarray:
        return self.points[:, 0].astype(np.int64)

    def bary(self) -> np.ndarray:
        u = self.points[:, 1]
        v = self.points[:, 2]
        w = 1.0 - u - v
        return np.column_stack([u, v, w])


@dataclass
class Atlas:
    system: str
    lines: list[AtlasLine] = field(default_factory=list)
    version: str = "0.1"
    provenance: str = ""
    validated: bool = False

    # ── I/O ───────────────────────────────────────────────────────────────────
    @classmethod
    def load(cls, path: str) -> "Atlas":
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        lines = [
            AtlasLine(
                name=ln["name"],
                region=ln.get("region", ""),
                points=np.asarray(ln["points"], dtype=np.float64).reshape(-1, 3),
            )
            for ln in data["lines"]
        ]
        return cls(
            system=data["system"],
            lines=lines,
            version=data.get("version", "0.1"),
            provenance=data.get("provenance", ""),
            validated=bool(data.get("validated", False)),
        )

    def save(self, path: str) -> None:
        data = {
            "system": self.system,
            "version": self.version,
            "provenance": self.provenance,
            "validated": self.validated,
            "lines": [
                {
                    "name": ln.name,
                    "region": ln.region,
                    "points": [[int(round(p[0])), round(float(p[1]), 6), round(float(p[2]), 6)]
                               for p in ln.points],
                }
                for ln in self.lines
            ],
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    # ── 校验 ───────────────────────────────────────────────────────────────────
    def validate(self, num_triangles: int) -> list[str]:
        """返回问题列表（空 = 通过）。检查三角面索引合法、重心坐标范围、曲线非空。"""
        issues: list[str] = []
        if not self.lines:
            issues.append("图谱不含任何曲线")
        for ln in self.lines:
            if ln.points.shape[0] < 2:
                issues.append(f"曲线 {ln.name!r} 点数 < 2")
            tris = ln.tris()
            if tris.min(initial=0) < 0 or (tris.size and tris.max() >= num_triangles):
                issues.append(f"曲线 {ln.name!r} 三角面索引越界")
            bary = ln.bary()
            if np.any(bary < -1e-3) or np.any(bary > 1 + 1e-3):
                issues.append(f"曲线 {ln.name!r} 重心坐标越界 [0,1]")
        return issues
