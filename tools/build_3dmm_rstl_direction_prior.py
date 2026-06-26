#!/usr/bin/env python3
"""Build a dev-local RSTL direction prior for a user-supplied 3DMM mesh.

This generic entrypoint is intended for licensed local FLAME/BFM/custom 3DMM
topologies. It writes only draft review scaffolds, keeps outputs out of git by
default, and never marks a prior as clinically validated.
"""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path

from build_flame_rstl_direction_prior import DEFAULT_SOURCE_PRIOR, ROOT, build_3dmm_direction_prior

DEFAULT_OUTPUT = ROOT / "local_outputs" / "rstl_3dmm_direction_prior.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-prior", default=str(DEFAULT_SOURCE_PRIOR))
    parser.add_argument("--target-topology", required=True, help="JSON file with target triangle indices")
    parser.add_argument(
        "--target-vertices",
        required=True,
        help="JSON file with target neutral mesh vertices",
    )
    parser.add_argument(
        "--target-name",
        default="user-supplied-3dmm",
        help="human-readable target 3DMM name written to provenance, e.g. bfm or flame",
    )
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--generated-at", default=date.today().isoformat())
    parser.add_argument("--k-nearest", type=int, default=7)
    parser.add_argument("--low-confidence-threshold", type=float, default=0.35)
    parser.add_argument(
        "--no-align-source-bbox",
        action="store_true",
        help="disable source-prior bbox center/scale alignment before nearest-neighbor transfer",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    generated_at = args.generated_at
    if generated_at == "now":
        generated_at = datetime.now(timezone.utc).date().isoformat()
    try:
        prior = build_3dmm_direction_prior(
            source_prior_path=Path(args.source_prior),
            target_topology_path=Path(args.target_topology),
            target_vertices_path=Path(args.target_vertices),
            generated_at=generated_at,
            target_model_name=args.target_name,
            generated_by="tools/build_3dmm_rstl_direction_prior.py",
            k_nearest=args.k_nearest,
            low_confidence_threshold=args.low_confidence_threshold,
            align_source_bbox=not args.no_align_source_bbox,
        )
    except FileNotFoundError as exc:
        print(f"[skip] missing dev-local 3DMM asset: {exc.filename}")
        print("       Provide licensed local topology and neutral vertex JSON files.")
        return 0

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(prior, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"[ok] {output} {prior['coverage']['sample_count']} samples, "
        f"low_confidence={prior['coverage']['low_confidence_count']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
