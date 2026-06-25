"""Shared provenance helpers for incision candidates."""
from __future__ import annotations

from typing import Any

from ..lines.direction import DirectionQueryResult


def direction_provenance(direction: DirectionQueryResult | dict[str, Any]) -> dict[str, Any]:
    if isinstance(direction, DirectionQueryResult):
        return {
            "direction_source": direction.source,
            "direction_nearest_distance": direction.nearest_distance,
            "direction_support_count": direction.support_count,
            "direction_angular_spread_deg": direction.angular_spread_deg,
            "direction_confidence_reasons": list(direction.confidence_reasons),
        }
    return {
        "direction_source": direction.get("source"),
        "direction_nearest_distance": direction.get("nearest_distance"),
        "direction_support_count": direction.get("support_count"),
        "direction_angular_spread_deg": direction.get("angular_spread_deg"),
        "direction_confidence_reasons": list(direction.get("confidence_reasons") or []),
    }
