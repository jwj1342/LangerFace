"""Face region heuristics used by Stage 2 planning guardrails."""
from __future__ import annotations

from .regions import AnatomyContext, classify_region

__all__ = ["AnatomyContext", "classify_region"]
