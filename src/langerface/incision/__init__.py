"""Deterministic Stage 2 incision geometry.

The package exposes geometry candidates for engineering review.  Its defaults
are draft clinical rules and must not be interpreted as surgical instructions.
"""

from .fusiform import FusiformRules, fusiform_profile, generate_fusiform_incision

__all__ = [
    "FusiformRules",
    "fusiform_profile",
    "generate_fusiform_incision",
]
