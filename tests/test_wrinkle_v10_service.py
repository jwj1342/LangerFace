from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

try:
    from deploy.wrinkle_v10 import service
except ModuleNotFoundError as error:
    pytest.skip(f"V10 provider dependencies are not installed: {error.name}", allow_module_level=True)
from fastapi import HTTPException
from fastapi.testclient import TestClient


class FakeDetector:
    process = type("Process", (), {"returncode": None})()

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    async def run(
        self,
        _request_file: Path,
        _rgba_file: Path,
        output_directory: Path,
        _disconnected: asyncio.Task[bool],
    ) -> None:
        output_directory.mkdir()
        (output_directory / "response.json").write_text(json.dumps({
            "schemaVersion": "langerface.wrinkle-fine-lines.v1",
            "detectorVersion": service.DETECTOR_VERSION,
            "source": {"imageSha256": "SYNTHETIC", "width": 2, "height": 2},
            "summary": {"lineCount": 4},
            "lines": [
                {"id": name, "class": "wrinkle", "anatomicalClass": name,
                 "points": [[0, 0], [1, 1]]}
                for name in ("forehead", "glabellar", "nasal_dorsum", "crow_feet")
            ],
        }), encoding="utf-8")


def synthetic_request() -> bytes:
    metadata = json.dumps({"width": 2, "height": 2, "landmarks": [], "baselineLines": []}).encode()
    return len(metadata).to_bytes(4, "little") + metadata + bytes(range(16))


def test_provider_health_auth_and_binary_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service, "detector", FakeDetector())
    monkeypatch.setenv("WRINKLE_V10_SERVICE_TOKEN", "test-token")
    with TestClient(service.app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json() == {
            "schemaVersion": service.PROVIDER_SCHEMA,
            "providerId": "remote-python-v10",
            "detectorVersion": service.DETECTOR_VERSION,
            "checkpointSha256": service.CHECKPOINT_SHA256,
            "processingLocation": "remote_service",
            "ready": True,
        }
        assert client.post("/v1/detect", content=synthetic_request()).status_code == 401
        response = client.post(
            "/v1/detect",
            content=synthetic_request(),
            headers={"Authorization": "Bearer test-token", "Content-Type": "application/octet-stream"},
        )
        assert response.status_code == 200
        assert response.json()["detectorVersion"] == service.DETECTOR_VERSION
        assert len(response.json()["lines"]) == 4


def test_provider_rejects_invalid_and_oversized_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service, "detector", FakeDetector())
    monkeypatch.setenv("WRINKLE_V10_SERVICE_TOKEN", "test-token")
    headers = {"Authorization": "Bearer test-token", "Content-Type": "application/octet-stream"}
    with TestClient(service.app) as client:
        assert client.post("/v1/detect", content=b"bad", headers=headers).status_code == 400
        oversized = b"x" * (service.MAXIMUM_REQUEST_BYTES + 1)
        assert client.post("/v1/detect", content=oversized, headers=headers).status_code == 413


def test_provider_has_a_single_bounded_inference_slot() -> None:
    async def check() -> None:
        detector = service.DetectorProcess()
        await detector.request_lock.acquire()
        disconnected = asyncio.create_task(asyncio.sleep(60, result=False))
        try:
            with pytest.raises(HTTPException) as raised:
                await detector.run(Path("request"), Path("rgba"), Path("output"), disconnected)
            assert raised.value.status_code == 429
        finally:
            detector.request_lock.release()
            disconnected.cancel()

    asyncio.run(check())


def test_production_detector_process_starts_with_released_checkpoint() -> None:
    async def check() -> None:
        detector = service.DetectorProcess()
        try:
            await detector.start()
            assert detector.process is not None
            assert detector.process.returncode is None
        finally:
            await detector.stop()

    asyncio.run(check())
