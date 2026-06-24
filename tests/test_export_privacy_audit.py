import json
import subprocess
import sys
from pathlib import Path

from tools.audit_export_privacy import audit_files, audit_payload

ROOT = Path(__file__).resolve().parents[1]


def _safe_review_export() -> dict:
    return {
        "schema_version": "incision-review-export/v0.3",
        "current": {
            "schema_version": "incision-review-record/v0.3",
            "id": "candidate-safe",
            "review": {"reviewer": "coded-reviewer-1", "notes": "synthetic fixture only"},
            "tumor": {"kind": "subcutaneous", "center": [0, 0, 0], "diameter_mm": 10},
            "candidate": {"type": "linear", "polyline": [[-1, 0, 0], [1, 0, 0]]},
            "provider_config": {"api_key_present": True, "api_key": "[redacted]"},
            "privacy_audit": {
                "raw_image_sent": False,
                "raw_video_sent": False,
                "contains_face_image": False,
            },
        },
        "saved": [],
    }


def test_privacy_audit_accepts_sanitized_review_export(tmp_path: Path):
    path = tmp_path / "safe_review.json"
    path.write_text(json.dumps(_safe_review_export()), encoding="utf-8")

    report = audit_files([path])

    assert report["schema_version"] == "export-privacy-audit/v0.1"
    assert report["passed"] is True
    assert report["violation_count"] == 0


def test_privacy_audit_flags_secret_raw_media_and_pii():
    payload = _safe_review_export()
    record = payload["current"]
    record["provider_config"]["api_key"] = "sk-test-not-redacted"
    record["privacy_audit"]["raw_image_sent"] = True
    record["patient_name"] = "Alice Example"
    record["review"]["notes"] = "Call +1 555 010 9999 before review"

    report = audit_payload(payload, file="unsafe.json")
    codes = {v["code"] for v in report["violations"]}

    assert report["passed"] is False
    assert "secret_value_present" in codes
    assert "raw_media_flag_true" in codes
    assert "pii_field_present" in codes
    assert "pii_pattern_present" in codes


def test_privacy_audit_cli_exits_nonzero_on_violation(tmp_path: Path):
    unsafe = _safe_review_export()
    unsafe["current"]["provider_config"]["token"] = "plain-token"
    input_path = tmp_path / "unsafe.json"
    output_path = tmp_path / "privacy_report.json"
    input_path.write_text(json.dumps(unsafe), encoding="utf-8")

    proc = subprocess.run(
        [
            sys.executable,
            "tools/audit_export_privacy.py",
            str(input_path),
            "--output",
            str(output_path),
        ],
        cwd=ROOT,
        text=True,
    )

    assert proc.returncode == 1
    report = json.loads(output_path.read_text(encoding="utf-8"))
    assert report["violation_count"] == 1
    assert report["violations"][0]["code"] == "secret_value_present"
