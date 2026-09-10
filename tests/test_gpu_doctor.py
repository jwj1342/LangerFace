from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("gpu_doctor", ROOT / "deploy" / "gpu" / "doctor.py")
assert SPEC and SPEC.loader
gpu_doctor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gpu_doctor)


class FakeSession:
    def __init__(self, providers: list[str]):
        self.providers = providers

    def get_providers(self) -> list[str]:
        return self.providers


class FakeOrt:
    def __init__(self, active_providers=None, error: Exception | None = None):
        self.active_providers = active_providers or ["CUDAExecutionProvider", "CPUExecutionProvider"]
        self.error = error
        self.preloaded = False

    def preload_dlls(self) -> None:
        self.preloaded = True

    def InferenceSession(self, model: bytes, providers):
        assert model == b"real-model"
        assert providers[0][0] == "CUDAExecutionProvider"
        if self.error:
            raise self.error
        return FakeSession(self.active_providers)


def test_create_cuda_session_accepts_real_cuda_provider() -> None:
    ort = FakeOrt()

    session = gpu_doctor.create_cuda_session(ort, b"real-model")

    assert ort.preloaded is True
    assert session.get_providers()[0] == "CUDAExecutionProvider"


def test_create_cuda_session_rejects_cpu_fallback() -> None:
    ort = FakeOrt(active_providers=["CPUExecutionProvider"])

    with pytest.raises(RuntimeError, match="fell back.*CPUExecutionProvider"):
        gpu_doctor.create_cuda_session(ort, b"real-model")


def test_create_cuda_session_preserves_missing_library_error() -> None:
    ort = FakeOrt(error=RuntimeError("libcudnn.so.9: cannot open shared object file"))

    with pytest.raises(RuntimeError, match="libcudnn.so.9"):
        gpu_doctor.create_cuda_session(ort, b"real-model")
