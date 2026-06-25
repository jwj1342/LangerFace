import json
import subprocess
import sys
from pathlib import Path

from tools.audit_tumor_input import audit_files, audit_payload

from langerface.tumor import tumor_from_payload

ROOT = Path(__file__).resolve().parents[1]


def _safe_cutaneous_payload() -> dict:
    boundary = [
        [3.0, 2.0, 0.0],
        [3.5, 2.8, 0.0],
        [4.2, 3.1, 0.0],
        [4.8, 2.7, 0.0],
        [5.0, 2.0, 0.0],
        [4.0, 1.4, 0.0],
    ]
    return {
        "schema_version": "tumor-input/v0.2",
        "exported_at": "2026-06-25T00:00:00Z",
        "tumor": {
            "kind": "cutaneous",
            "center": [4.0, 2.0, 0.0],
            "diameter_mm": 8.0,
            "depth_mm": None,
            "margin_mm": 2.0,
            "boundary": boundary,
            "boundary_mode": "freehand",
            "boundary_source": "manual_freehand",
            "source": "manual_web_agent",
            "author": "clinician",
            "units": "mm",
        },
        "tumor_quality": {
            "passed": True,
            "warning_count": 0,
            "warnings": [],
        },
        "boundary_summary": {
            "mode": "freehand",
            "source": "manual_freehand",
            "point_count": len(boundary),
            "boundary_used": True,
            "units_per_mm": 0.1,
            "summary_axis": [1.0, 0.0, 0.0],
            "summary_normal": [0.0, 0.0, 1.0],
            "center": [4.083333333333333, 2.3333333333333335, 0.0],
            "axis_diameter_mm": 21.66666666666666,
            "perp_diameter_mm": 18.66666666666667,
            "area_mm2": 207.49999999999997,
            "area_ratio_to_diameter_disk": 4.1280813364460345,
            "self_intersection": False,
            "center_shift_mm": 3.4359213546813843,
            "aspect_ratio": 1.1607142857142851,
        },
        "privacy_audit": {
            "raw_image_sent": False,
            "raw_video_sent": False,
            "contains_face_image": False,
            "contains_abstract_face_coordinates": True,
        },
    }


def test_tumor_from_payload_reads_wrapped_export():
    tumor = tumor_from_payload(_safe_cutaneous_payload())

    assert tumor.kind == "cutaneous"
    assert tumor.boundary_mode == "freehand"
    assert len(tumor.boundary) == 6


def test_tumor_input_audit_accepts_safe_frontend_export(tmp_path: Path):
    path = tmp_path / "tumor_input.json"
    path.write_text(json.dumps(_safe_cutaneous_payload()), encoding="utf-8")

    report = audit_files([path])

    assert report["schema_version"] == "tumor-input-audit/v0.1"
    assert report["passed"] is True
    assert report["reports"][0]["tumor_quality"]["warning_count"] == 0
    assert report["reports"][0]["boundary_summary"]["point_count"] == 6
    assert report["reports"][0]["boundary_summary"]["area_mm2"] == 207.49999999999997
    assert report["reports"][0]["boundary_summary"]["self_intersection"] is False


def test_tumor_input_audit_flags_non_mm_units():
    payload = _safe_cutaneous_payload()
    payload["tumor"]["units"] = "cm"

    report = audit_payload(payload, file="unsafe-units.json")
    codes = {issue["code"] for issue in report["issues"]}

    assert report["passed"] is False
    assert report["high_issue_count"] == 1
    assert "non_mm_tumor_units" in codes


def test_tumor_input_audit_flags_boundary_summary_mismatch():
    payload = _safe_cutaneous_payload()
    payload["boundary_summary"]["point_count"] = 2
    payload["boundary_summary"]["boundary_used"] = False

    report = audit_payload(payload, file="mismatch.json")
    mismatches = [issue for issue in report["issues"] if issue["code"] == "boundary_summary_mismatch"]

    assert report["passed"] is False
    assert len(mismatches) == 2
    assert {issue["path"] for issue in mismatches} == {
        "boundary_summary.point_count",
        "boundary_summary.boundary_used",
    }


def test_tumor_input_audit_flags_boundary_geometry_mismatch():
    payload = _safe_cutaneous_payload()
    payload["boundary_summary"]["area_mm2"] = 99.0
    payload["boundary_summary"]["self_intersection"] = True

    report = audit_payload(payload, file="bad-geometry-summary.json")
    mismatches = [issue for issue in report["issues"] if issue["code"] == "boundary_summary_mismatch"]

    assert report["passed"] is False
    assert {issue["path"] for issue in mismatches} >= {
        "boundary_summary.area_mm2",
        "boundary_summary.self_intersection",
    }


def test_tumor_input_audit_flags_raw_media_privacy_marker():
    payload = _safe_cutaneous_payload()
    payload["privacy_audit"]["raw_image_sent"] = True

    report = audit_payload(payload, file="raw-media.json")
    codes = {issue["code"] for issue in report["issues"]}

    assert report["passed"] is False
    assert "raw_media_flag_true" in codes


def test_tumor_input_audit_cli_exits_nonzero_on_high_issue(tmp_path: Path):
    payload = _safe_cutaneous_payload()
    payload["schema_version"] = "tumor-input/v0.1"
    input_path = tmp_path / "bad_schema.json"
    output_path = tmp_path / "tumor_audit.json"
    input_path.write_text(json.dumps(payload), encoding="utf-8")

    proc = subprocess.run(
        [
            sys.executable,
            "tools/audit_tumor_input.py",
            str(input_path),
            "--output",
            str(output_path),
        ],
        cwd=ROOT,
        text=True,
    )

    assert proc.returncode == 1
    report = json.loads(output_path.read_text(encoding="utf-8"))
    assert report["passed"] is False
    assert report["reports"][0]["issues"][0]["code"] == "unexpected_tumor_input_schema"
