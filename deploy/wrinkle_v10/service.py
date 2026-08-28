"""Authenticated production service for the exact local V10 detector process."""

from __future__ import annotations

import asyncio
import base64
import binascii
import collections
import hashlib
import hmac
import json
import os
import secrets
import sys
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

REPO = Path(__file__).resolve().parents[2]
DETECTOR = REPO / "tools" / "run_live_four_region_wrinkle.py"
CHECKPOINT = Path(os.environ.get(
    "WRINKLE_V10_CHECKPOINT",
    REPO / "assets" / "models" / "wrinkle_unet_patient_finetuned.pth",
))
PROVIDER_SCHEMA = "langerface.wrinkle-v10-provider.v1"
DETECTOR_VERSION = "paired-edge-v10-dynamic-four-region-1.0"
CHECKPOINT_SHA256 = "e301b8f70c8239c01504a0616b61acdf9ab9b5796f513d6e7294d4fa52b6a6c2"
# The browser sends lossless RGBA pixels; a 1280x1280 frame is over 6 MiB.
MAXIMUM_REQUEST_BYTES = 32 * 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 45.0
STARTUP_TIMEOUT_SECONDS = 120.0
TICKET_AUDIENCE = "langerface-wrinkle-v10"
TICKET_RATE_LIMIT = 6
TICKET_RATE_WINDOW_SECONDS = 60


class DetectorProcess:
    def __init__(self) -> None:
        self.process: asyncio.subprocess.Process | None = None
        self.start_lock = asyncio.Lock()
        self.request_lock = asyncio.Lock()

    async def start(self) -> None:
        async with self.start_lock:
            if self.process is not None and self.process.returncode is None:
                return
            actual_checkpoint_sha256 = hashlib.sha256(CHECKPOINT.read_bytes()).hexdigest()
            if actual_checkpoint_sha256 != CHECKPOINT_SHA256:
                raise RuntimeError(
                    "V10 checkpoint SHA-256 does not match the released provider contract"
                )
            self.process = await asyncio.create_subprocess_exec(
                sys.executable,
                str(DETECTOR),
                "--serve",
                "--checkpoint",
                str(CHECKPOINT),
                cwd=REPO,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=None,
            )
            try:
                line = await asyncio.wait_for(
                    self.process.stdout.readline(),
                    timeout=STARTUP_TIMEOUT_SECONDS,
                )
                ready = json.loads(line)
                if (
                    ready.get("type") != "ready"
                    or ready.get("detectorVersion") != DETECTOR_VERSION
                    or ready.get("checkpointSha256") != CHECKPOINT_SHA256
                ):
                    raise RuntimeError("V10 detector returned an invalid startup capability")
            except Exception:
                await self.stop()
                raise

    async def stop(self) -> None:
        process, self.process = self.process, None
        if process is None or process.returncode is not None:
            return
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=3.0)
        except TimeoutError:
            process.kill()
            await process.wait()

    async def run(
        self,
        request_file: Path,
        rgba_file: Path,
        output_directory: Path,
        disconnected: asyncio.Task[bool],
    ) -> None:
        if self.request_lock.locked():
            raise HTTPException(429, "V10 detector is busy; retry after the current image finishes")
        await self.request_lock.acquire()
        try:
            await self.start()
            assert self.process is not None and self.process.stdin and self.process.stdout
            message = json.dumps({
                "id": 1,
                "request": str(request_file),
                "rgba": str(rgba_file),
                "output": str(output_directory),
            })
            self.process.stdin.write((message + "\n").encode("utf-8"))
            await self.process.stdin.drain()
            result_task = asyncio.create_task(self.process.stdout.readline())
            done, _ = await asyncio.wait(
                {result_task, disconnected},
                timeout=REQUEST_TIMEOUT_SECONDS,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if disconnected in done and disconnected.result():
                result_task.cancel()
                await self.stop()
                raise HTTPException(499, "Client disconnected; V10 inference was terminated")
            if result_task not in done:
                result_task.cancel()
                await self.stop()
                raise HTTPException(504, "V10 inference exceeded 45 seconds and was terminated")
            payload = json.loads((await result_task).decode("utf-8"))
            if payload.get("ok") is not True:
                raise HTTPException(500, payload.get("error") or "V10 detector failed")
        except HTTPException:
            raise
        except Exception as error:
            await self.stop()
            raise HTTPException(503, f"V10 detector process failed: {error}") from error
        finally:
            self.request_lock.release()


detector = DetectorProcess()


class TicketAuthorizer:
    def __init__(self) -> None:
        self.used: dict[str, int] = {}
        self.requests: dict[str, collections.deque[float]] = {}

    def reset(self) -> None:
        self.used.clear()
        self.requests.clear()

    def _ticket_payload(self, token: str) -> dict[str, object]:
        secret = os.environ.get("WRINKLE_V10_TICKET_SECRET", "")
        if not secret:
            raise HTTPException(503, "V10 ticket verification is not configured")
        try:
            encoded, supplied_signature = token.split(".", 1)
            expected_signature = hmac.new(
                secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256,
            ).digest()
            supplied = base64.urlsafe_b64decode(
                supplied_signature + "=" * (-len(supplied_signature) % 4),
            )
            if not hmac.compare_digest(supplied, expected_signature):
                raise ValueError("signature")
            decoded = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
            payload = json.loads(decoded)
            if not isinstance(payload, dict):
                raise ValueError("payload")
        except (binascii.Error, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise HTTPException(401, "Invalid V10 detection ticket") from error
        return payload

    def authorize(self, request: Request) -> str:
        supplied = request.headers.get("authorization", "")
        if not supplied.startswith("Bearer "):
            raise HTTPException(401, "Unauthorized")
        token = supplied.removeprefix("Bearer ")
        service_token = os.environ.get("WRINKLE_V10_SERVICE_TOKEN", "")
        if service_token and secrets.compare_digest(token, service_token):
            return "service-token"

        payload = self._ticket_payload(token)
        now = int(time.time())
        origin = request.headers.get("origin", "").rstrip("/")
        try:
            issued_at = int(payload.get("iat", 0))
            expires_at = int(payload.get("exp", 0))
            maximum_bytes = int(payload.get("maxBytes", 0))
        except (TypeError, ValueError) as error:
            raise HTTPException(401, "Invalid V10 detection ticket claims") from error
        if (
            payload.get("v") != 1
            or payload.get("aud") != TICKET_AUDIENCE
            or payload.get("scope") != "detect"
            or not isinstance(payload.get("sub"), str)
            or not isinstance(payload.get("jti"), str)
            or payload.get("origin") != origin
            or issued_at > now + 10
            or expires_at < now
            or expires_at - issued_at > 120
            or maximum_bytes != MAXIMUM_REQUEST_BYTES
        ):
            raise HTTPException(401, "Invalid or expired V10 detection ticket")

        jti = str(payload["jti"])
        for used_jti, expiry in list(self.used.items()):
            if expiry < now:
                self.used.pop(used_jti, None)
        if jti in self.used:
            raise HTTPException(401, "V10 detection ticket was already used")

        subject = str(payload["sub"])
        cutoff = time.monotonic() - TICKET_RATE_WINDOW_SECONDS
        for stored_subject, stored_history in list(self.requests.items()):
            while stored_history and stored_history[0] < cutoff:
                stored_history.popleft()
            if not stored_history:
                self.requests.pop(stored_subject, None)
        history = self.requests.setdefault(subject, collections.deque())
        while history and history[0] < cutoff:
            history.popleft()
        if len(history) >= TICKET_RATE_LIMIT:
            raise HTTPException(429, "V10 detection rate limit exceeded; retry later")
        history.append(time.monotonic())
        self.used[jti] = expires_at
        return subject


ticket_authorizer = TicketAuthorizer()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await detector.start()
    try:
        yield
    finally:
        await detector.stop()


app = FastAPI(
    title="LangerFace V10 wrinkle provider",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip().rstrip("/")
        for origin in os.environ.get("WRINKLE_V10_ALLOWED_ORIGINS", "").split(",")
        if origin.strip()
    ],
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=600,
)


async def wait_for_disconnect(request: Request) -> bool:
    while not await request.is_disconnected():
        await asyncio.sleep(0.1)
    return True


def capability() -> dict[str, object]:
    return {
        "schemaVersion": PROVIDER_SCHEMA,
        "providerId": "remote-python-v10",
        "detectorVersion": DETECTOR_VERSION,
        "checkpointSha256": CHECKPOINT_SHA256,
        "processingLocation": "remote_service",
        "ready": True,
    }


@app.get("/health")
async def health() -> JSONResponse:
    if detector.process is None or detector.process.returncode is not None:
        raise HTTPException(503, "V10 detector is not ready")
    return JSONResponse(capability(), headers={"Cache-Control": "no-store"})


@app.post("/v1/detect")
async def detect(request: Request) -> Response:
    ticket_authorizer.authorize(request)
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAXIMUM_REQUEST_BYTES:
            raise HTTPException(413, "V10 request must be between 1 byte and 32 MB")
        chunks.append(chunk)
    body = b"".join(chunks)
    if not body:
        raise HTTPException(400, "V10 request is empty")
    if len(body) < 5:
        raise HTTPException(400, "V10 request is empty")
    metadata_length = int.from_bytes(body[:4], "little")
    if metadata_length <= 0 or metadata_length > len(body) - 4:
        raise HTTPException(400, "V10 request metadata is invalid")
    try:
        metadata = json.loads(body[4:4 + metadata_length])
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise HTTPException(400, "V10 request metadata is invalid JSON") from error
    width, height = int(metadata.get("width", 0)), int(metadata.get("height", 0))
    rgba = body[4 + metadata_length:]
    if width <= 0 or height <= 0 or len(rgba) != width * height * 4:
        raise HTTPException(400, "V10 request pixel dimensions do not match")

    disconnected = asyncio.create_task(wait_for_disconnect(request))
    try:
        with tempfile.TemporaryDirectory(prefix="langerface-v10-") as directory:
            root = Path(directory)
            request_file, rgba_file = root / "request.json", root / "input.rgba"
            output_directory = root / "output"
            request_file.write_text(json.dumps(metadata), encoding="utf-8")
            rgba_file.write_bytes(rgba)
            await detector.run(request_file, rgba_file, output_directory, disconnected)
            response = (output_directory / "response.json").read_bytes()
            return Response(
                response,
                media_type="application/json",
                headers={"Cache-Control": "no-store"},
            )
    finally:
        if not disconnected.done():
            disconnected.cancel()
