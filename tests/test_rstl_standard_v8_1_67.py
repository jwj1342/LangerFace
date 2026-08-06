from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from build_field_atlas_standard_v1 import build  # noqa: E402
from langerface.config import CANONICAL_OBJ  # noqa: E402
from langerface.geometry import CanonicalFaceModel  # noqa: E402


def test_v8_1_67_remains_reproducible_as_the_frozen_v68_baseline(tmp_path):
    reference_path = ROOT / "assets" / "rstl_standard_reference_v8_1_67.json"
    reference = json.loads(reference_path.read_text(encoding="utf-8"))
    assert reference["atlasVersion"] == "8.1.67"
    constraints = reference["extraction"]["doctorConstraints"]
    assert "foreheadAdditionalDownwardShiftV64" in constraints
    assert "lateralCanthusShortArcsV65" not in constraints

    rebuilt = build(CanonicalFaceModel.from_obj(CANONICAL_OBJ), reference)
    rebuilt_path = tmp_path / "atlas_rstl.json"
    rebuilt.save(str(rebuilt_path))
    rebuilt_payload = json.loads(rebuilt_path.read_text(encoding="utf-8"))
    assert rebuilt_payload["validated"] is False
    assert rebuilt_payload["atlasVersion"] == "8.1.67"
    assert len(rebuilt_payload["lines"]) == 133
    assert sum(len(line["points"]) for line in rebuilt_payload["lines"]) == 14315
    assert sum(
        line["region"] == "forehead_bridge_arc_v15"
        for line in rebuilt_payload["lines"]
    ) == 14
    assert not any(
        line["region"] == "lateral_canthus_short_arc_v65"
        for line in rebuilt_payload["lines"]
    )
