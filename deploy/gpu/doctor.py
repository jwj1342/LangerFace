#!/usr/bin/env python3
"""Report GPU deployment prerequisites with actionable failures."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = ROOT / "web" / "compat" / "personalized" / "model"


def command_version(command: str, arguments: list[str]) -> bool:
    executable = shutil.which(command)
    if not executable:
        print(f"[missing] {command} is not on PATH")
        return False
    result = subprocess.run([executable, *arguments], capture_output=True, text=True, timeout=20, check=False)
    version_output = result.stdout or result.stderr
    first_line = version_output.splitlines()[0] if version_output else "unknown version"
    print(f"[ok] {command}: {first_line}")
    return result.returncode == 0


def create_cuda_session(ort, model: bytes):
    """Load the real model so missing CUDA/cuDNN libraries cannot look healthy."""
    ort.preload_dlls()
    session = ort.InferenceSession(
        model,
        providers=[("CUDAExecutionProvider", {"use_tf32": "0"}), "CPUExecutionProvider"],
    )
    active_providers = session.get_providers()
    if not active_providers or active_providers[0] != "CUDAExecutionProvider":
        raise RuntimeError(
            "CUDA session fell back instead of loading CUDAExecutionProvider; "
            f"active providers: {active_providers}"
        )
    return session


def main() -> int:
    checks = [
        command_version("node", ["--version"]),
        command_version("ffmpeg", ["-version"]),
        command_version("ffprobe", ["-version"]),
        command_version("nvidia-smi", ["--query-gpu=name,driver_version", "--format=csv,noheader"]),
    ]
    metadata_path = MODEL_DIR / "wrinkle-yolov8s-seg-640.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    part_paths = [MODEL_DIR / name for name in metadata["chunks"]]
    missing = [path.name for path in part_paths if not path.is_file()]
    if missing:
        print("[missing] private wrinkle model; run: python tools/install_wrinkle_model.py")
        checks.append(False)
    else:
        print("[ok] private wrinkle model chunks are installed")
        checks.append(True)
        try:
            import onnxruntime as ort

            model = b"".join(path.read_bytes() for path in part_paths)
            session = create_cuda_session(ort, model)
            print(
                f"[ok] ONNX Runtime {ort.__version__}: "
                f"real model session uses {session.get_providers()[0]}"
            )
            checks.append(True)
        except Exception as error:
            print(f"[missing] ONNX Runtime CUDA session failed: {error}")
            print("  Check the NVIDIA driver, CUDA 12, cuDNN 9, and onnxruntime-gpu installation.")
            checks.append(False)
    return 0 if all(checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
