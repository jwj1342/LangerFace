#!/usr/bin/env python3
"""Audit sanitized LangerFace JSON exports for privacy boundary violations.

This is a lightweight pre-share gate for review records, tumor inputs, and
diagnostics JSON. It does not certify compliance; it catches the mistakes that
should never leave a local or controlled clinical environment.
"""
from __future__ import annotations

import argparse
import base64
import json
import re
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "export-privacy-audit/v0.1"

SECRET_KEY_HINTS = ("api_key", "secret", "token", "authorization", "password", "private_key")
REDACTED_VALUES = {"", "[redacted]", "redacted", "***", "null", "none"}
PII_KEY_HINTS = (
    "patient_name",
    "patientname",
    "mrn",
    "medical_record",
    "hospital_number",
    "id_card",
    "phone",
    "email",
    "date_of_birth",
    "dob",
    "address",
)
MEDIA_KEY_HINTS = ("image", "photo", "video", "frame", "texture", "pixels", "exif", "ultrasound")
RAW_MEDIA_FLAG_KEYS = ("raw_image_sent", "raw_video_sent", "contains_face_image", "contains_raw_media")

EMAIL_RE = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
PHONE_RE = re.compile(r"(?<!\d)(?:\+?\d[\d .()\-]{8,}\d)(?!\d)")


def load_payload(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _path(parts: tuple[str, ...]) -> str:
    return ".".join(parts) if parts else "$"


def _nonempty_text(value: Any) -> str | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        return None
    text = str(value).strip()
    return text or None


def _is_redacted(value: Any) -> bool:
    text = _nonempty_text(value)
    return text is None or text.lower() in REDACTED_VALUES


def _looks_like_embedded_media(text: str) -> bool:
    if text.startswith(("data:image/", "data:video/", "data:application/dicom")):
        return True
    if len(text) < 256:
        return False
    compact = text.strip()
    if len(compact) % 4 != 0:
        return False
    try:
        decoded = base64.b64decode(compact[:4096], validate=True)
    except Exception:
        return False
    return decoded.startswith((b"\\xff\\xd8", b"\\x89PNG", b"GIF8", b"RIFF", b"DICM"))


def _violation(
    file: str,
    path: tuple[str, ...],
    code: str,
    message: str,
    severity: str = "high",
) -> dict[str, str]:
    return {
        "file": file,
        "path": _path(path),
        "code": code,
        "severity": severity,
        "message": message,
    }


def _key_contains(path: tuple[str, ...], hints: tuple[str, ...]) -> bool:
    return any(hint in part.lower() for part in path for hint in hints)


def _audit_node(value: Any, *, file: str, path: tuple[str, ...]) -> list[dict[str, str]]:
    violations: list[dict[str, str]] = []

    if isinstance(value, dict):
        for key, child in value.items():
            child_path = (*path, str(key))
            violations.extend(_audit_node(child, file=file, path=child_path))
        return violations

    if isinstance(value, list):
        for idx, child in enumerate(value):
            violations.extend(_audit_node(child, file=file, path=(*path, str(idx))))
        return violations

    lower_path = tuple(part.lower() for part in path)
    leaf = lower_path[-1] if lower_path else ""
    text = _nonempty_text(value)

    if leaf in RAW_MEDIA_FLAG_KEYS and value is True:
        violations.append(
            _violation(
                file,
                path,
                "raw_media_flag_true",
                "Export marks raw image/video media as sent or present.",
            )
        )

    secret_path = _key_contains(lower_path, SECRET_KEY_HINTS)
    if secret_path and not leaf.endswith("_present") and not _is_redacted(value):
        violations.append(
            _violation(file, path, "secret_value_present", "Secret-bearing field is not redacted.")
        )

    if _key_contains(lower_path, PII_KEY_HINTS) and text is not None:
        violations.append(
            _violation(file, path, "pii_field_present", "Direct patient identifier field is populated.")
        )

    if text and (EMAIL_RE.search(text) or PHONE_RE.search(text)):
        violations.append(
            _violation(
                file,
                path,
                "pii_pattern_present",
                "String contains an email address or phone-like number.",
            )
        )

    if text and _key_contains(lower_path, MEDIA_KEY_HINTS) and _looks_like_embedded_media(text):
        violations.append(
            _violation(
                file,
                path,
                "embedded_media_payload",
                "Field appears to contain embedded image/video bytes.",
            )
        )

    return violations


def audit_payload(payload: Any, *, file: str = "<memory>") -> dict[str, Any]:
    violations = _audit_node(payload, file=file, path=())
    return {
        "schema_version": SCHEMA_VERSION,
        "input_files": [file],
        "checked_files": 1,
        "passed": not violations,
        "violation_count": len(violations),
        "violations": violations,
    }


def audit_files(paths: list[str | Path]) -> dict[str, Any]:
    all_violations: list[dict[str, str]] = []
    input_files = [str(path) for path in paths]
    for path in paths:
        payload = load_payload(path)
        all_violations.extend(audit_payload(payload, file=str(path))["violations"])
    return {
        "schema_version": SCHEMA_VERSION,
        "input_files": input_files,
        "checked_files": len(paths),
        "passed": not all_violations,
        "violation_count": len(all_violations),
        "violations": all_violations,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", help="Sanitized JSON exports to audit")
    parser.add_argument("--output", "-o", help="Write audit JSON report")
    parser.add_argument("--no-fail", action="store_true", help="Always exit 0 after writing the report")
    args = parser.parse_args(argv)

    report = audit_files([Path(path) for path in args.inputs])
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0 if report["passed"] or args.no_fail else 1


if __name__ == "__main__":
    raise SystemExit(main())
