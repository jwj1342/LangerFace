"""下载运行所需的 MediaPipe 资产到 assets/。

  python tools/download_assets.py

下载：
  - canonical_face_model.obj  （标准脸网格：顶点/三角拓扑/UV）
  - face_landmarker.task       （Face Landmarker 模型 bundle，478 关键点）
"""
from __future__ import annotations

import os
import sys
import urllib.request

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")

DOWNLOADS = {
    "canonical_face_model.obj":
        "https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/"
        "mediapipe/modules/face_geometry/data/canonical_face_model.obj",
    "face_landmarker.task":
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
        "face_landmarker/float16/1/face_landmarker.task",
}


def _progress(block_num, block_size, total_size):
    if total_size > 0:
        pct = min(100, block_num * block_size * 100 // total_size)
        sys.stdout.write(f"\r    {pct:3d}%")
        sys.stdout.flush()


def main() -> int:
    os.makedirs(ASSETS, exist_ok=True)
    for name, url in DOWNLOADS.items():
        dst = os.path.join(ASSETS, name)
        if os.path.exists(dst) and os.path.getsize(dst) > 0:
            print(f"[skip] {name} 已存在")
            continue
        print(f"[get ] {name}\n       {url}")
        try:
            urllib.request.urlretrieve(url, dst, _progress)
            print(f"\r       完成 -> {dst} ({os.path.getsize(dst)} 字节)")
        except Exception as e:
            print(f"\n[fail] {name}: {e}")
            print("       请检查网络，或手动下载到 assets/ 目录。")
            return 1
    print("全部资产就绪。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
