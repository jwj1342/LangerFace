"""标定相机模型：像素↔世界射线、点投影、射线-网格求交（多视角 3D 抬升用）。

cv2 / trimesh 延迟导入，使本模块在无这些重型依赖时仍可被导入。
相机参数取自 HeadSpace 风格的 dict：``{f"{view}_K", f"{view}_Rt", f"{view}_distortion",
f"{view}_height", f"{view}_width"}``。
"""
from __future__ import annotations

import numpy as np


def get_cam_params(params: dict, view_id: int, scale: float = 1.0):
    """读取某视角的 (K_scaled, Rt, dist, (h,w))；scale 同时缩放 K 的像素尺度。"""
    K = np.array(params[f"{view_id}_K"], dtype=np.float64)
    Rt = np.array(params[f"{view_id}_Rt"], dtype=np.float64)
    dist = np.array(params[f"{view_id}_distortion"], dtype=np.float64).reshape(-1)
    h_src = int(params[f"{view_id}_height"])
    w_src = int(params[f"{view_id}_width"])
    K_scaled = K.copy()
    K_scaled[:2, :] *= scale
    return K_scaled, Rt, dist, (int(round(h_src * scale)), int(round(w_src * scale)))


def undistort_pixels_to_normalized(uv_pix: np.ndarray, K: np.ndarray, dist: np.ndarray) -> np.ndarray:
    import cv2

    uv = np.asarray(uv_pix, dtype=np.float64).reshape(-1, 1, 2)
    xy = cv2.undistortPoints(uv, K, dist, P=None)
    return xy.reshape(-1, 2)


def rays_world_from_pixels(uv_pix, K, Rt, dist, rt_mode: str):
    """像素 → 世界射线 (origins(N,3), dirs(N,3))。rt_mode: 'w2c' 或 'c2w'。"""
    R = np.asarray(Rt, dtype=np.float64)[:, :3]
    t = np.asarray(Rt, dtype=np.float64)[:, 3]
    xy = undistort_pixels_to_normalized(uv_pix, K, dist)
    dirs_cam = np.concatenate([xy, np.ones((xy.shape[0], 1))], axis=1)
    dirs_cam /= np.linalg.norm(dirs_cam, axis=1, keepdims=True) + 1e-12
    if rt_mode == "w2c":
        Cw = -R.T @ t
        dirs_w = (R.T @ dirs_cam.T).T
    elif rt_mode == "c2w":
        Cw = t
        dirs_w = (R @ dirs_cam.T).T
    else:
        raise ValueError(f"未知 rt_mode {rt_mode!r}")
    origins = np.repeat(Cw.reshape(1, 3), dirs_w.shape[0], axis=0)
    dirs_w /= np.linalg.norm(dirs_w, axis=1, keepdims=True) + 1e-12
    return origins, dirs_w


def project_points_to_image(Pw, K, Rt, dist, rt_mode: str) -> np.ndarray:
    """世界点 (N,3) → 像素 (N,2)。"""
    import cv2

    R = np.asarray(Rt, dtype=np.float64)[:, :3]
    t = np.asarray(Rt, dtype=np.float64)[:, 3].reshape(3, 1)
    Pw = np.asarray(Pw, dtype=np.float64)
    if rt_mode == "w2c":
        Pc = (R @ Pw.T + t).T
    else:
        Pc = (R.T @ (Pw.T - t)).T
    zero = np.zeros((3, 1), dtype=np.float64)
    uv, _ = cv2.projectPoints(Pc, zero, zero, K, dist)
    return uv.reshape(-1, 2)


def intersect_rays_mesh(origins, dirs, mesh):
    """射线与 trimesh 网格求首个交点，返回 (P(N,3) nan-filled, hit(N,) bool)。"""
    loc, ray_id, _ = mesh.ray.intersects_location(origins, dirs, multiple_hits=False)
    n = np.asarray(origins).shape[0]
    hit = np.zeros((n,), dtype=bool)
    P = np.full((n, 3), np.nan, dtype=np.float64)
    hit[ray_id] = True
    P[ray_id] = np.asarray(loc, dtype=np.float64)
    return P, hit
