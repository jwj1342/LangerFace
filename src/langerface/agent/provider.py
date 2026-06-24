"""LLM provider abstraction for local Qwen and future remote endpoints."""
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

    Works with Ollama, vLLM, and most hosted chat-completions endpoints by
    changing base_url/model/api_key only.
    """

    def __init__(
        self,
        *,
        base_url: str = "http://127.0.0.1:11434/v1",
        model: str = "qwen3:8b",
        api_key: str = "ollama",
        timeout_s: float = 20.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.timeout_s = timeout_s

    @classmethod
    def from_env(cls) -> OpenAICompatibleProvider:
        return cls(
            base_url=os.environ.get("LANGERFACE_LLM_BASE_URL", "http://127.0.0.1:11434/v1"),
            model=os.environ.get("LANGERFACE_LLM_MODEL", "qwen3:8b"),
            api_key=os.environ.get("LANGERFACE_LLM_API_KEY", "ollama"),
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


class OllamaProvider(OpenAICompatibleProvider):
    """Ollama native chat client.

    Native Ollama supports ``think: false`` for Qwen3-style thinking models,
    which is materially faster for this UI summary use case than the generic
    OpenAI-compatible endpoint.
    """

    def __init__(
        self,
        *,
        base_url: str = "http://127.0.0.1:11434",
        model: str = "qwen3:8b",
        api_key: str = "ollama",
        timeout_s: float = 20.0,
    ) -> None:
        super().__init__(base_url=base_url, model=model, api_key=api_key, timeout_s=timeout_s)

    @classmethod
    def from_env(cls) -> OllamaProvider:
        return cls(
            base_url=os.environ.get("LANGERFACE_OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
            model=os.environ.get("LANGERFACE_LLM_MODEL", "qwen3:8b"),
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
            "stream": False,
            "think": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        req = urllib.request.Request(
            f"{self.base_url}/api/chat",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:  # noqa: S310
                data = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"LLM provider request failed: {exc}") from exc

        message = data.get("message", {})
        content = str(message.get("content", ""))
        reasoning = str(message.get("thinking", ""))
        return LLMResponse(content=content.strip(), reasoning=reasoning.strip(), model=self.model, raw=data)


def provider_from_env() -> OpenAICompatibleProvider:
    provider = os.environ.get("LANGERFACE_LLM_PROVIDER", "ollama").strip().lower()
    if provider == "ollama":
        return OllamaProvider.from_env()
    return OpenAICompatibleProvider.from_env()
