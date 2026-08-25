"""Adapt paired-edge wrinkle centerlines to the RSTL refinement input contract."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

CLASS_MAP = {
    "forehead": "forehead",
    "glabellar": "frown",
    "nasal_dorsum": "wrinkle",
    "crow_feet": "wrinkle",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    source = json.loads(args.input.read_text(encoding="utf-8"))
    lines = source.get("fusedLines")
    if not isinstance(lines, list) or not lines:
        raise ValueError("paired-edge input must contain non-empty fusedLines")
    source_image = source.get("source", {})
    required = ("sha256", "width", "height")
    if any(key not in source_image for key in required):
        raise ValueError("paired-edge source metadata is incomplete")

    adapted_lines = []
    for index, line in enumerate(lines, start=1):
        class_name = CLASS_MAP.get(str(line.get("class")))
        points = line.get("points")
        if class_name is None or not isinstance(points, list) or len(points) < 2:
            continue
        adapted_lines.append(
            {
                "id": f"paired-edge-v10-{index:03d}",
                "sourceSegmentId": str(line.get("id", f"fused-{index:03d}")),
                "class": class_name,
                "lengthPx": float(line.get("lengthPx", 0.0)),
                "points": points,
            }
        )

    payload = {
        "schemaVersion": "langerface.wrinkle-fine-lines.v1",
        "validated": False,
        "purpose": "wrinkle_guided_rstl_refinement_input",
        "source": {
            "imageFilename": Path(str(source_image.get("path", "wrinkle.png"))).name,
            "imageSha256": str(source_image["sha256"]),
            "width": int(source_image["width"]),
            "height": int(source_image["height"]),
            "imageEmbedded": False,
        },
        "method": {
            "adapter": "paired-edge-v10-fused-lines-to-wrinkle-fine-lines-v1",
            "geometryChanged": False,
            "classMap": CLASS_MAP,
        },
        "summary": {
            "lineCount": len(adapted_lines),
            "sourceSchemaVersion": source.get("schemaVersion"),
        },
        "lines": adapted_lines,
        "limitations": ["Class names are mapped to the three-class RSTL refinement contract."],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(args.output), "lineCount": len(adapted_lines)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
