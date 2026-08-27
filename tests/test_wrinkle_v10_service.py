from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import subprocess
import time
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

    def __init__(self) -> None:
        self.last_temporary_root: Path | None = None

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
        self.last_temporary_root = output_directory.parent
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


def product_maximum_request() -> bytes:
    size = 1280
    metadata = json.dumps({
        "width": size,
        "height": size,
        "landmarks": [],
        "baselineLines": [],
    }).encode()
    return len(metadata).to_bytes(4, "little") + metadata + bytes(size * size * 4)


def detection_ticket(
    secret: str,
    *,
    origin: str = "https://preview.example.test",
    subject: str = "synthetic-user",
    jti: str = "ticket-1",
) -> str:
    now = int(time.time())
    payload = {
        "v": 1,
        "aud": service.TICKET_AUDIENCE,
        "scope": "detect",
        "sub": subject,
        "origin": origin,
        "iat": now,
        "exp": now + 90,
        "jti": jti,
        "maxBytes": service.MAXIMUM_REQUEST_BYTES,
    }
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode(),
    ).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(hmac.new(
        secret.encode(), encoded.encode(), hashlib.sha256,
    ).digest()).decode().rstrip("=")
    return f"{encoded}.{signature}"


def test_provider_health_auth_and_binary_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service, "detector", FakeDetector())
    monkeypatch.setenv("WRINKLE_V10_SERVICE_TOKEN", "test-token")
    service.ticket_authorizer.reset()
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


def test_browser_ticket_is_origin_bound_single_use_and_accepts_product_maximum(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    secret = "ticket-secret-at-least-32-random-bytes"
    fake_detector = FakeDetector()
    monkeypatch.setattr(service, "detector", fake_detector)
    monkeypatch.delenv("WRINKLE_V10_SERVICE_TOKEN", raising=False)
    monkeypatch.setenv("WRINKLE_V10_TICKET_SECRET", secret)
    service.ticket_authorizer.reset()
    ticket = detection_ticket(secret)
    headers = {
        "Authorization": f"Bearer {ticket}",
        "Content-Type": "application/octet-stream",
        "Origin": "https://preview.example.test",
    }
    with TestClient(service.app) as client:
        response = client.post("/v1/detect", content=product_maximum_request(), headers=headers)
        assert response.status_code == 200
        replay = client.post("/v1/detect", content=synthetic_request(), headers=headers)
        assert replay.status_code == 401

        wrong_origin = detection_ticket(secret, jti="ticket-2")
        denied = client.post("/v1/detect", content=synthetic_request(), headers={
            **headers,
            "Authorization": f"Bearer {wrong_origin}",
            "Origin": "https://attacker.example",
        })
        assert denied.status_code == 401
    assert fake_detector.last_temporary_root is not None
    assert not fake_detector.last_temporary_root.exists()


def test_node_issued_ticket_is_accepted_by_python_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    secret = "ticket-secret-at-least-32-random-bytes"
    script = """
      import { issueDetectionTicket } from './web/api/wrinkle-v10.mjs';
      const request = { headers: {
        'x-forwarded-for': '192.0.2.10',
        'user-agent': 'cross-language-contract-test'
      }};
      console.log(issueDetectionTicket(
        request,
        'https://preview.example.test',
        'ticket-secret-at-least-32-random-bytes'
      ).token);
    """
    token = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=service.REPO,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    monkeypatch.setattr(service, "detector", FakeDetector())
    monkeypatch.delenv("WRINKLE_V10_SERVICE_TOKEN", raising=False)
    monkeypatch.setenv("WRINKLE_V10_TICKET_SECRET", secret)
    service.ticket_authorizer.reset()
    with TestClient(service.app) as client:
        response = client.post("/v1/detect", content=synthetic_request(), headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/octet-stream",
            "Origin": "https://preview.example.test",
        })
        assert response.status_code == 200


def test_browser_ticket_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "ticket-secret-at-least-32-random-bytes"
    monkeypatch.setattr(service, "detector", FakeDetector())
    monkeypatch.delenv("WRINKLE_V10_SERVICE_TOKEN", raising=False)
    monkeypatch.setenv("WRINKLE_V10_TICKET_SECRET", secret)
    service.ticket_authorizer.reset()
    with TestClient(service.app) as client:
        for index in range(service.TICKET_RATE_LIMIT):
            response = client.post("/v1/detect", content=synthetic_request(), headers={
                "Authorization": f"Bearer {detection_ticket(secret, jti=f'rate-{index}')}",
                "Content-Type": "application/octet-stream",
                "Origin": "https://preview.example.test",
            })
            assert response.status_code == 200
        limited = client.post("/v1/detect", content=synthetic_request(), headers={
            "Authorization": f"Bearer {detection_ticket(secret, jti='rate-limited')}",
            "Content-Type": "application/octet-stream",
            "Origin": "https://preview.example.test",
        })
        assert limited.status_code == 429


def test_provider_rejects_invalid_and_oversized_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service, "detector", FakeDetector())
    monkeypatch.setenv("WRINKLE_V10_SERVICE_TOKEN", "test-token")
    service.ticket_authorizer.reset()
    headers = {"Authorization": "Bearer test-token", "Content-Type": "application/octet-stream"}
    with TestClient(service.app) as client:
        assert client.post("/v1/detect", content=b"bad", headers=headers).status_code == 400
        oversized = b"x" * (service.MAXIMUM_REQUEST_BYTES + 1)
        assert client.post("/v1/detect", content=oversized, headers=headers).status_code == 413


def test_provider_rejects_malformed_browser_ticket_as_unauthorized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    secret = "ticket-secret-at-least-32-random-bytes"
    monkeypatch.setattr(service, "detector", FakeDetector())
    monkeypatch.delenv("WRINKLE_V10_SERVICE_TOKEN", raising=False)
    monkeypatch.setenv("WRINKLE_V10_TICKET_SECRET", secret)
    service.ticket_authorizer.reset()
    encoded = base64.urlsafe_b64encode(b"[]").decode().rstrip("=")
    signature = base64.urlsafe_b64encode(hmac.new(
        secret.encode(), encoded.encode(), hashlib.sha256,
    ).digest()).decode().rstrip("=")
    headers = {
        "Authorization": f"Bearer {encoded}.{signature}",
        "Content-Type": "application/octet-stream",
        "Origin": "https://preview.example.test",
    }
    with TestClient(service.app) as client:
        assert client.post("/v1/detect", content=synthetic_request(), headers=headers).status_code == 401
        invalid_base64 = client.post("/v1/detect", content=synthetic_request(), headers={
            **headers,
            "Authorization": "Bearer not-base64.***",
        })
        assert invalid_base64.status_code == 401


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


def test_detector_timeout_and_disconnect_terminate_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeStdin:
        def write(self, _value: bytes) -> None:
            return None

        async def drain(self) -> None:
            return None

    class HangingStdout:
        async def readline(self) -> bytes:
            await asyncio.sleep(60)
            return b""

    class FakeProcess:
        def __init__(self) -> None:
            self.returncode = None
            self.stdin = FakeStdin()
            self.stdout = HangingStdout()
            self.terminated = False

        def terminate(self) -> None:
            self.terminated = True
            self.returncode = 0

        def kill(self) -> None:
            self.terminate()

        async def wait(self) -> int:
            return int(self.returncode or 0)

    class StubDetector(service.DetectorProcess):
        def __init__(self) -> None:
            super().__init__()
            self.fake_process = FakeProcess()

        async def start(self) -> None:
            self.process = self.fake_process  # type: ignore[assignment]

    async def check() -> None:
        monkeypatch.setattr(service, "REQUEST_TIMEOUT_SECONDS", 0.01)
        timed = StubDetector()
        disconnected = asyncio.create_task(asyncio.sleep(60, result=False))
        with pytest.raises(HTTPException) as timeout_error:
            await timed.run(Path("request"), Path("rgba"), Path("output"), disconnected)
        assert timeout_error.value.status_code == 504
        assert timed.fake_process.terminated
        disconnected.cancel()

        cancelled = StubDetector()
        disconnected_now = asyncio.create_task(asyncio.sleep(0, result=True))
        with pytest.raises(HTTPException) as disconnect_error:
            await cancelled.run(Path("request"), Path("rgba"), Path("output"), disconnected_now)
        assert disconnect_error.value.status_code == 499
        assert cancelled.fake_process.terminated

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
