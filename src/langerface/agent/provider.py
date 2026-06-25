"""LLM provider abstraction for OpenAI-compatible and vLLM endpoints."""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class LLMResponse:
    content: str
    reasoning: str
    model: str
    raw: dict[str, Any]


class OpenAICompatibleProvider:
    """Small OpenAI-compatible chat client.

    Works with vLLM and hosted chat-completions endpoints by changing
    base_url/model/api_key only.
    """

    def __init__(
        self,
        *,
        base_url: str = "http://127.0.0.1:8000/v1",
        model: str = "Qwen/Qwen3-14B",
        api_key: str = "EMPTY",
        timeout_s: float = 20.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.timeout_s = timeout_s

    @classmethod
    def from_env(cls) -> OpenAICompatibleProvider:
        return cls(
            base_url=os.environ.get("LANGERFACE_LLM_BASE_URL", "http://127.0.0.1:8000/v1"),
            model=os.environ.get("LANGERFACE_LLM_MODEL", "Qwen/Qwen3-14B"),
            api_key=os.environ.get("LANGERFACE_LLM_API_KEY", "EMPTY"),
            timeout_s=float(os.environ.get("LANGERFACE_LLM_TIMEOUT_S", "20")),
        )

    def chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        max_tokens: int = 700,
    ) -> LLMResponse:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:  # noqa: S310
                data = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"LLM provider request failed: {exc}") from exc

        content = str(data.get("choices", [{}])[0].get("message", {}).get("content", ""))
        reasoning = ""
        # Qwen thinking models may include <think>...</think>. Keep only a short
        # explicit reasoning summary for UI display, not hidden chain of thought.
        match = re.search(r"<think>(.*?)</think>", content, flags=re.DOTALL | re.IGNORECASE)
        if match:
            reasoning = re.sub(r"\s+", " ", match.group(1)).strip()
            content = (content[: match.start()] + content[match.end():]).strip()
        return LLMResponse(content=content.strip(), reasoning=reasoning, model=self.model, raw=data)


def provider_from_env() -> OpenAICompatibleProvider:
    return OpenAICompatibleProvider.from_env()


def provider_from_config(config: dict[str, Any] | None) -> OpenAICompatibleProvider:
    """Build a provider from request-scoped UI config.

    The API key is accepted only by the local agent proxy and is not echoed in
    planning results.
    """

    if not config:
        return provider_from_env()
    timeout_s = float(config.get("timeout_s", os.environ.get("LANGERFACE_LLM_TIMEOUT_S", "20")))
    model = str(config.get("model", os.environ.get("LANGERFACE_LLM_MODEL", "Qwen/Qwen3-14B")))
    return OpenAICompatibleProvider(
        base_url=str(config.get("base_url", os.environ.get("LANGERFACE_LLM_BASE_URL", "http://127.0.0.1:8000/v1"))),
        model=model,
        api_key=str(config.get("api_key", os.environ.get("LANGERFACE_LLM_API_KEY", ""))),
        timeout_s=timeout_s,
    )
