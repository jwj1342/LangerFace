import copy
import json
import subprocess
import sys
from pathlib import Path

from tools.audit_clinical_rules import audit_rules

from langerface.clinical import default_clinical_rules

ROOT = Path(__file__).resolve().parents[1]


def _asset_rules() -> dict:
    return json.loads((ROOT / "assets" / "clinical_rules_face_incision.json").read_text())


def test_clinical_rules_audit_accepts_current_python_defaults():
    report = audit_rules(_asset_rules(), default_clinical_rules())

    assert report["schema_version"] == "clinical-rules-drift-audit/v0.1"
    assert report["passed"] is True
    assert report["issue_count"] == 0
    assert "lower_eyelid" in report["checked_protective_direction_hints"]
    assert "lower_eyelid_margin" in report["checked_guardrail_thresholds"]
    assert report["checked_region_count"] >= 15


def test_clinical_rules_audit_flags_python_threshold_drift():
    python_rules = default_clinical_rules()
    python_rules["guardrails"]["free_margin_distance_thresholds_mm"]["lower_eyelid"] = 6.0

    report = audit_rules(_asset_rules(), python_rules)
    issues = [issue for issue in report["issues"] if issue["code"] == "clinical_rule_default_drift"]

    assert report["passed"] is False
    assert any(issue["path"] == "guardrails.free_margin_distance_thresholds_mm" for issue in issues)


def test_clinical_rules_audit_flags_protective_direction_hint_drift():
    python_rules = copy.deepcopy(default_clinical_rules())
    python_rules["guardrails"]["protective_direction_hints"]["nasal_ala"]["canonical_axis"] = [1, 0, 0]

    report = audit_rules(_asset_rules(), python_rules)

    assert report["passed"] is False
    assert any(issue["path"] == "guardrails.protective_direction_hints" for issue in report["issues"])


def test_clinical_rules_audit_cli_writes_report(tmp_path: Path):
    output_path = tmp_path / "clinical_rules_audit.json"
    proc = subprocess.run(
        [
            sys.executable,
            "tools/audit_clinical_rules.py",
            "--output",
            str(output_path),
        ],
        cwd=ROOT,
        text=True,
    )

    assert proc.returncode == 0
    report = json.loads(output_path.read_text(encoding="utf-8"))
    assert report["passed"] is True
    assert report["source_version"] == "0.2-agentic-incision"
