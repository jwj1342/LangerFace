#!/usr/bin/env python3
"""Audit draft RSTL / 3DMM prior assets.

The #86 assets are intentionally draft-only. This script makes that boundary
machine-checkable so direction priors cannot quietly become "validated" or be
used across the wrong topology.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

DEFAULT_MANIFEST = Path("assets/rstl_3dmm_prior_manifest.json")
DRAFT_REVIEW_STATUS = "draft_not_clinically_validated"


class AuditError(ValueError):
    """Raised when the prior manifest violates the draft asset contract."""


def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise AuditError(f"missing JSON file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise AuditError(f"invalid JSON in {path}: {exc}") from exc


def _require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def _vector_norm(values: list[Any]) -> float:
    return math.sqrt(sum(float(value) * float(value) for value in values))


def _audit_direction_prior(prior: dict[str, Any], asset: dict[str, Any], errors: list[str]) -> None:
    prefix = f"asset {asset.get('id', '<missing-id>')}"
    _require(
        prior.get("schema_version") == "rstl-direction-prior/v0.1",
        f"{prefix}: unexpected direction prior schema_version",
        errors,
    )
    _require(prior.get("system") == asset.get("system"), f"{prefix}: system mismatch", errors)
    _require(prior.get("topologyId") == asset.get("topologyId"), f"{prefix}: topologyId mismatch", errors)
    _require(
        prior.get("topologyVersion") == asset.get("topologyVersion"),
        f"{prefix}: topologyVersion mismatch",
        errors,
    )
    _require(
        prior.get("validated") is False,
        f"{prefix}: direction prior must remain validated:false",
        errors,
    )
    _require(
        prior.get("review_status") == DRAFT_REVIEW_STATUS,
        f"{prefix}: direction prior review_status must be {DRAFT_REVIEW_STATUS}",
        errors,
    )
    _require(
        prior.get("source_atlas_validated") is False,
        f"{prefix}: source atlas must remain draft until #2 clinical review",
        errors,
    )
    _require(
        "FLAME/BFM registration remains pending" in " ".join(prior.get("limitations", [])),
        f"{prefix}: limitations must state FLAME/BFM registration is pending",
        errors,
    )

    samples = prior.get("samples")
    coverage = prior.get("coverage", {})
    _require(
        isinstance(samples, list) and len(samples) > 0,
        f"{prefix}: samples must be a non-empty list",
        errors,
    )
    if isinstance(samples, list):
        _require(
            prior.get("triangle_count") == len(samples),
            f"{prefix}: triangle_count must match samples",
            errors,
        )
        _require(
            coverage.get("sample_count") == len(samples),
            f"{prefix}: coverage sample_count must match",
            errors,
        )
        for index, sample in enumerate(samples):
            _require(sample.get("tri") == index, f"{prefix}: sample tri indices must be contiguous", errors)
            vector = sample.get("vector")
            confidence = sample.get("confidence")
            _require(
                isinstance(vector, list) and len(vector) == 3,
                f"{prefix}: sample {index} vector invalid",
                errors,
            )
            if isinstance(vector, list) and len(vector) == 3:
                _require(
                    math.isclose(_vector_norm(vector), 1.0, rel_tol=2e-4, abs_tol=2e-4),
                    f"{prefix}: sample {index} vector is not unit length",
                    errors,
                )
            _require(
                isinstance(confidence, int | float) and 0.0 <= float(confidence) <= 1.0,
                f"{prefix}: sample {index} confidence outside [0, 1]",
                errors,
            )


def audit_manifest(manifest_path: Path, root: Path) -> dict[str, Any]:
    manifest = _load_json(manifest_path)
    errors: list[str] = []
    assets = manifest.get("assets")

    _require(manifest.get("validated") is False, "manifest must remain validated:false", errors)
    _require(
        manifest.get("review_status") == DRAFT_REVIEW_STATUS,
        f"manifest review_status must be {DRAFT_REVIEW_STATUS}",
        errors,
    )
    _require(
        "#2" in str(manifest.get("clinical_validation_gate", "")),
        "manifest must point validation to issue #2",
        errors,
    )
    _require(isinstance(assets, list) and len(assets) > 0, "manifest assets must be a non-empty list", errors)

    audited_assets: list[dict[str, Any]] = []
    ids: set[str] = set()
    if isinstance(assets, list):
        for asset in assets:
            asset_id = str(asset.get("id", ""))
            prefix = f"asset {asset_id or '<missing-id>'}"
            _require(bool(asset_id), f"{prefix}: id is required", errors)
            _require(asset_id not in ids, f"{prefix}: duplicate id", errors)
            ids.add(asset_id)
            _require(asset.get("validated") is False, f"{prefix}: must remain validated:false", errors)
            _require(bool(asset.get("system")), f"{prefix}: system is required", errors)
            _require(bool(asset.get("topologyId")), f"{prefix}: topologyId is required", errors)
            _require(bool(asset.get("topologyVersion")), f"{prefix}: topologyVersion is required", errors)
            _require(bool(asset.get("status")), f"{prefix}: status is required", errors)
            _require(
                isinstance(asset.get("uses"), list) and asset["uses"],
                f"{prefix}: uses must be non-empty",
                errors,
            )
            _require(
                isinstance(asset.get("limitations"), list) and asset["limitations"],
                f"{prefix}: limitations must be non-empty",
                errors,
            )

            path_value = asset.get("path")
            status = str(asset.get("status", ""))
            if path_value is None:
                _require(
                    status.startswith("pending_"),
                    f"{prefix}: null path must have pending status",
                    errors,
                )
                _require(
                    any("#61" in str(item) for item in asset.get("limitations", [])),
                    f"{prefix}: pending 3DMM assets must reference #61 workflow",
                    errors,
                )
            else:
                asset_path = root / str(path_value)
                _require(asset_path.exists(), f"{prefix}: path does not exist: {path_value}", errors)
                if asset_id == "mediapipe_rstl_direction_prior" and asset_path.exists():
                    _audit_direction_prior(_load_json(asset_path), asset, errors)

            audited_assets.append(
                {
                    "id": asset_id,
                    "topologyId": asset.get("topologyId"),
                    "status": asset.get("status"),
                    "validated": asset.get("validated"),
                    "path": path_value,
                }
            )

    if errors:
        raise AuditError("\n".join(errors))

    return {
        "ok": True,
        "manifest": str(manifest_path),
        "review_status": manifest.get("review_status"),
        "validated": manifest.get("validated"),
        "asset_count": len(audited_assets),
        "assets": audited_assets,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        default=str(DEFAULT_MANIFEST),
        help="RSTL/3DMM prior manifest JSON path",
    )
    parser.add_argument("--root", default=".", help="repository root for resolving manifest asset paths")
    parser.add_argument(
        "--json",
        action="store_true",
        help="print a JSON summary instead of a short text line",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(list(argv or sys.argv[1:]))
    root = Path(args.root).resolve()
    manifest = Path(args.manifest)
    if not manifest.is_absolute():
        manifest = root / manifest
    try:
        summary = audit_manifest(manifest, root)
    except AuditError as exc:
        print(f"[fail] RSTL/3DMM prior audit failed:\n{exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(f"[ok] audited {summary['asset_count']} draft RSTL/3DMM prior assets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
