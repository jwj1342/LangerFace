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


def test_v8_1_67_is_reproducible_and_synced_to_the_web(tmp_path):
    atlas_path = ROOT / "assets" / "atlas_rstl.json"
    web_atlas_path = ROOT / "web" / "assets" / "atlas_rstl.json"
    reference_path = ROOT / "assets" / "rstl_standard_reference_v8_1_67.json"

    payload = json.loads(atlas_path.read_text(encoding="utf-8"))
    assert payload["validated"] is False
    assert len(payload["lines"]) == 133
    assert sum(len(line["points"]) for line in payload["lines"]) == 14315
    assert sum(
        line["region"] == "forehead_bridge_arc_v15" for line in payload["lines"]
    ) == 14
    assert web_atlas_path.read_bytes() == atlas_path.read_bytes()

    reference = json.loads(reference_path.read_text(encoding="utf-8"))
    constraints = reference["extraction"]["doctorConstraints"]
    assert "foreheadAdditionalDownwardShiftV64" in constraints

    rebuilt = build(CanonicalFaceModel.from_obj(CANONICAL_OBJ), reference)
    rebuilt_path = tmp_path / "atlas_rstl.json"
    rebuilt.save(str(rebuilt_path))
    assert rebuilt_path.read_bytes() == atlas_path.read_bytes()
