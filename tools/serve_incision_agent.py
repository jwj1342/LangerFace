#!/usr/bin/env python3
"""Local HTTP proxy for the incision-planning agent.

Default provider is Ollama's OpenAI-compatible API:
  LANGERFACE_LLM_BASE_URL=http://127.0.0.1:11434/v1
  LANGERFACE_LLM_MODEL=qwen3:8b

The endpoint falls back to deterministic planning if the LLM is unavailable.
"""
from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from langerface.agent import (  # noqa: E402
    OpenAICompatibleProvider,
    plan_incision_case,
    provider_from_config,
    provider_from_env,
)
from langerface.lines import Atlas  # noqa: E402


def _load_assets() -> tuple[np.ndarray, np.ndarray, Atlas]:
    web_assets = ROOT / "web" / "assets"
    vertices = np.asarray(json.loads((web_assets / "canonical_vertices.json").read_text()), dtype=np.float64)
    triangles = np.asarray(json.loads((web_assets / "triangles.json").read_text()), dtype=np.int64)
    atlas = Atlas.load(str(web_assets / "atlas_rstl.json"))
    return vertices, triangles, atlas


class AgentHandler(BaseHTTPRequestHandler):
    vertices: np.ndarray
    triangles: np.ndarray
    atlas: Atlas
    provider: OpenAICompatibleProvider | None
    use_llm: bool

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()
        self.wfile.write(data)

    def _send_sse(self, result: dict[str, Any]) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()

        def emit(event: str, payload: dict[str, Any]) -> None:
            data = json.dumps(payload, ensure_ascii=False)
            self.wfile.write(f"event: {event}\ndata: {data}\n\n".encode())
            self.wfile.flush()

        emit("provider", result.get("provider", {}))
        for index, step in enumerate(result.get("trace", [])):
            emit("trace", {"index": index, **step})
        emit("result", result)
        emit("done", {"ok": True})

    def _plan_from_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        tumor = payload.get("tumor", payload)
        if not isinstance(tumor, dict):
            raise ValueError("request must include a tumor object")
        request_provider = self.provider
        provider_config = payload.get("provider_config")
        if self.use_llm and isinstance(provider_config, dict):
            request_provider = provider_from_config(provider_config)
        result = plan_incision_case(
            tumor,
            self.vertices,
            self.triangles,
            self.atlas,
            provider=request_provider,
            use_llm=self.use_llm,
        )
        if isinstance(provider_config, dict):
            safe_config = {k: v for k, v in provider_config.items() if k != "api_key"}
            safe_config["api_key"] = "[redacted]" if provider_config.get("api_key") else ""
            result["provider_config"] = safe_config
        return result

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send_json(204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/api/health":
            self._send_json(200, {
                "ok": True,
                "provider": None if self.provider is None else {
                    "base_url": self.provider.base_url,
                    "model": self.provider.model,
                },
                "llm_enabled": self.use_llm,
            })
            return
        self._send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in {"/api/agentic-incision", "/api/agentic-incision/stream"}:
            self._send_json(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            result = self._plan_from_payload(payload)
            if self.path.endswith("/stream"):
                self._send_sse(result)
            else:
                self._send_json(200, result)
        except Exception as exc:  # noqa: BLE001
            self._send_json(400, {"error": str(exc)})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-llm", action="store_true", help="disable LLM provider calls")
    args = parser.parse_args()

    vertices, triangles, atlas = _load_assets()
    AgentHandler.vertices = vertices
    AgentHandler.triangles = triangles
    AgentHandler.atlas = atlas
    AgentHandler.use_llm = not args.no_llm
    AgentHandler.provider = None if args.no_llm else provider_from_env()

    server = ThreadingHTTPServer((args.host, args.port), AgentHandler)
    print(f"incision agent server listening on http://{args.host}:{args.port}")
    print("POST /api/agentic-incision")
    print("POST /api/agentic-incision/stream")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
