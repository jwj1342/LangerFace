"""Vercel Python 云函数 /api/fit —— 把 FLAME 拟合到一组 MediaPipe 关键点（3D 轨 · 模式 A）。

POST  {"landmarks": [[x,y,z], ...]}   (MediaPipe 关键点，N≥468；478 含 iris 亦可)
  →   {"topologyId":"flame-2023", "verts":[[x,y,z]×5023], "faces":[[a,b,c]×9976],
       "residual":float, "nLandmarks":int}
GET   → 健康检查 / 元信息。

**纯 numpy、CPU、秒级**——线性形状最小二乘 + Umeyama 刚性对齐。运行时只需 numpy，
紧凑基 flame_basis.npz 由 tools/build_flame_basis.py 离线抽出（不下发浏览器，仅服务端）。
拟合数学与 src/langerface/flame.py 一致（此处为云函数边界的精简内联副本，改动需同步）。

License：基源自 FLAME 2023 Open (CC-BY-4.0)，见 flame_basis.NOTICE.md。
"""
import json
import os
from http.server import BaseHTTPRequestHandler

import numpy as np

_BASIS = None


def _load_basis():
    global _BASIS
    if _BASIS is None:
        path = os.path.join(os.path.dirname(__file__), "flame_basis.npz")
        d = np.load(path)
        _BASIS = {k: d[k] for k in d.files}
    return _BASIS


def _sample_bary(arr, faces, fi, bc):
    pts = arr[faces[fi]]
    if arr.ndim == 2:
        return np.einsum("lc,lcx->lx", bc, pts)
    return np.einsum("lc,lcxn->lxn", bc, pts)


def _umeyama(src, tgt):
    """等权 Umeyama 相似变换：s·R·src + t ≈ tgt。返回 (s, R, t)。"""
    mx, my = src.mean(0), tgt.mean(0)
    x, y = src - mx, tgt - my
    cov = (y[:, :, None] * x[:, None, :]).sum(0) / len(src)
    u, dg, vt = np.linalg.svd(cov)
    s_mat = np.eye(3)
    if np.linalg.det(u) * np.linalg.det(vt) < 0:
        s_mat[2, 2] = -1.0
    rot = u @ s_mat @ vt
    var = (x * x).sum() / len(src)
    scale = float(np.trace(np.diag(dg) @ s_mat) / (var + 1e-12))
    t = my - scale * (rot @ mx)
    return scale, rot, t


def _fit(observed, basis, n_shape=None, reg=1e-4, iters=4):
    v0 = basis["v_template"].astype(np.float64)
    sd = basis["shapedirs"].astype(np.float64)
    faces = basis["faces"].astype(np.int64)
    fi = basis["lmk_face_idx"].astype(np.int64)
    bc = basis["lmk_b_coords"].astype(np.float64)
    li = basis["landmark_indices"].astype(np.int64)
    n = sd.shape[2] if not n_shape else min(int(n_shape), sd.shape[2])
    sd = sd[:, :, :n]
    keep = li < observed.shape[0]
    fi, bc, li = fi[keep], bc[keep], li[keep]
    if li.size < 4:
        raise ValueError("可用关键点不足（embedding 与观测点不匹配）")
    target = observed[li]
    l0 = _sample_bary(v0, faces, fi, bc)
    jac = _sample_bary(sd, faces, fi, bc)
    a = jac.reshape(-1, n)
    ata = a.T @ a + reg * np.eye(n)
    beta = np.zeros(n)
    s, rot, t = 1.0, np.eye(3), np.zeros(3)
    for _ in range(iters):
        lm = l0 + (a @ beta).reshape(-1, 3)
        s, rot, t = _umeyama(target, lm)
        tgt = (s * (rot @ target.T).T) + t
        beta = np.linalg.solve(ata, a.T @ (tgt - l0).reshape(-1))
    verts = v0 + np.einsum("vxn,n->vx", sd, beta)
    fit_lmk = _sample_bary(verts, faces, fi, bc)
    resid = float(np.sqrt(np.mean((fit_lmk - ((s * (rot @ target.T).T) + t)) ** 2)))
    return verts, faces, resid, int(li.size)


class handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        b = _load_basis()
        self._send(200, {
            "ok": True,
            "topologyId": "flame-2023",
            "vertexCount": int(b["v_template"].shape[0]),
            "nShape": int(b["shapedirs"].shape[2]),
            "usage": "POST {landmarks:[[x,y,z],...]} -> {verts,faces,residual,nLandmarks}",
        })

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            data = json.loads(self.rfile.read(length) or b"{}")
            lmks = np.asarray(data.get("landmarks"), dtype=np.float64)
            if lmks.ndim != 2 or lmks.shape[1] != 3:
                return self._send(400, {"error": "landmarks 必须是 (N,3) 数组"})
            verts, faces, resid, n_lmk = _fit(lmks, _load_basis(), n_shape=data.get("nShape"))
            self._send(200, {
                "topologyId": "flame-2023",
                "verts": np.round(verts, 5).tolist(),
                "faces": faces.tolist(),
                "residual": resid,
                "nLandmarks": n_lmk,
            })
        except Exception as exc:  # noqa: BLE001 — 云函数边界，任何错误都回 JSON 而非 500 崩
            self._send(400, {"error": str(exc)})
