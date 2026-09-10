#!/usr/bin/env python3
"""Report GPU deployment prerequisites with actionable failures."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = ROOT / "web" / "compat" / "personalized" / "model"


def command_version(command: str, arguments: list[str]) -> bool:
    executable = shutil.which(command)
    if not executable:
        print(f"[missing] {command} is not on PATH")
        return False
    result = subprocess.run(
        [executable, *arguments], capture_output=True, text=True, timeout=20, check=False
    )
    first_line = (result.stdout or result.stderr).splitlines()[0] if (result.stdout or result.stderr) else "unknown version"
    print(f"[ok] {command}: {first_line}")
    return result.returncode == 0


def main() -> int:
    checks = [
        command_version("node", ["--version"]),
        command_version("ffmpeg", ["-version"]),
        command_version("ffprobe", ["-version"]),
        command_version("nvidia-smi", ["--query-gpu=name,driver_version", "--format=csv,noheader"]),
    ]
    try:
        import onnxruntime as ort

        providers = ort.get_available_providers()
        cuda_ready = "CUDAExecutionProvider" in providers
        print(f"[{'ok' if cuda_ready else 'missing'}] ONNX Runtime {ort.__version__}: {providers}")
        if not cuda_ready:
            print("  Check the NVIDIA driver, CUDA 12, cuDNN 9, and onnxruntime-gpu installation.")
        checks.append(cuda_ready)
    except Exception as error:
        print(f"[missing] ONNX Runtime GPU could not be imported: {error}")
        checks.append(False)

    metadata_path = MODEL_DIR / "wrinkle-yolov8s-seg-640.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    missing = [name for name in metadata["chunks"] if not (MODEL_DIR / name).is_file()]
    if missing:
        print("[missing] private wrinkle model; run: python tools/install_wrinkle_model.py")
        checks.append(False)
    else:
        print("[ok] private wrinkle model chunks are installed")
        checks.append(True)
    return 0 if all(checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
