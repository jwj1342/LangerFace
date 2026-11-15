#!/usr/bin/env python3
"""Install the private wrinkle ONNX model into the repository runtime path."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "web" / "compat" / "personalized" / "model"
METADATA_PATH = MODEL_DIR / "wrinkle-yolov8s-seg-640.json"
CHUNK_BYTES = 12 * 1024 * 1024


def cached_hf_token() -> str | None:
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if token:
        return token.strip()
    token_path = Path.home() / ".cache" / "huggingface" / "token"
    if token_path.is_file():
        return token_path.read_text(encoding="utf-8").strip() or None
    return None


def download(url: str, destination: Path, token: str | None) -> None:
    headers = {"User-Agent": "LangerFace-model-installer/1"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=120) as response, destination.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
    except urllib.error.HTTPError as error:
        if error.code in {401, 403, 404}:
            raise RuntimeError(
                "Private Hugging Face model is unavailable. Ask the repository owner for access, "
                "then run `hf auth login` or set HF_TOKEN before retrying."
            ) from error
        raise


def main() -> int:
    metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    hf = metadata.get("hugging_face") or {}
    parser = argparse.ArgumentParser(
        description="Download, verify, and install the private wrinkle model without path edits."
    )
    parser.add_argument("--repo", default=os.environ.get("LANGERFACE_HF_MODEL_REPO") or hf.get("repository"))
    parser.add_argument(
        "--revision",
        default=os.environ.get("LANGERFACE_HF_MODEL_REVISION") or hf.get("revision") or "main",
    )
    parser.add_argument("--filename", default=hf.get("filename") or "wrinkle-yolov8s-seg-640.onnx")
    parser.add_argument("--source", type=Path, help="Install from a local ONNX file instead of Hugging Face")
    args = parser.parse_args()

    if not args.source and not args.repo:
        parser.error(
            "the private repository is not configured yet; pass --repo OWNER/REPOSITORY "
            "or set LANGERFACE_HF_MODEL_REPO"
        )

    expected_bytes = int(metadata["onnx_bytes"])
    expected_sha256 = str(metadata["onnx_sha256"]).lower()
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="langerface-model-") as temporary:
        model_path = Path(temporary) / args.filename
        if args.source:
            source = args.source.expanduser().resolve()
            if not source.is_file():
                raise FileNotFoundError(f"Model source does not exist: {source}")
            shutil.copyfile(source, model_path)
        else:
            quoted_revision = urllib.parse.quote(args.revision, safe="")
            quoted_filename = urllib.parse.quote(args.filename, safe="/")
            url = f"https://huggingface.co/{args.repo}/resolve/{quoted_revision}/{quoted_filename}"
            download(url, model_path, cached_hf_token())

        payload = model_path.read_bytes()
        actual_sha256 = hashlib.sha256(payload).hexdigest()
        if len(payload) != expected_bytes or actual_sha256 != expected_sha256:
            raise RuntimeError(
                "Downloaded model failed integrity verification: "
                f"received {len(payload)} bytes / {actual_sha256}, expected "
                f"{expected_bytes} bytes / {expected_sha256}."
            )

        chunks = [payload[offset : offset + CHUNK_BYTES] for offset in range(0, len(payload), CHUNK_BYTES)]
        expected_names = list(metadata["chunks"])
        if len(chunks) != len(expected_names):
            raise RuntimeError(f"Expected {len(expected_names)} chunks, generated {len(chunks)}")
        for name, chunk in zip(expected_names, chunks):
            target = MODEL_DIR / name
            temporary_target = target.with_suffix(target.suffix + ".tmp")
            temporary_target.write_bytes(chunk)
            temporary_target.replace(target)

    print(f"Installed and verified {expected_bytes} model bytes in {MODEL_DIR}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError) as error:
        print(f"Model installation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
