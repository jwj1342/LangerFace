"""Run a local, training-free four-class wrinkle detection comparison.

This experiment deliberately does not modify RSTL geometry. It compares the
checked-in browser YOLO evidence with the checked-in FFHQ-Wrinkle U-Net and a
classical Hessian ridge cue, then assigns wrinkle pixels to anatomy-derived
regions using MediaPipe landmarks.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parents[1]
PROJECT = REPO.parent
DEFAULT_INPUT = PROJECT / "langer线-cc" / "wrinkle.png"
DEFAULT_YOLO = PROJECT / "langer线-cc" / "wrinkle_rstl_experiment_v9" / "wrinkle_yolo_evidence.json"
DEFAULT_CHECKPOINT = REPO / "assets" / "models" / "wrinkle_unet_patient_finetuned.pth"
DEFAULT_FACE_MODEL = REPO / "assets" / "face_landmarker.task"
DEFAULT_OUTPUT = PROJECT / "langer线-cc" / "wrinkle_four_class_experiment_v1"
LONGERFACE_PYTHON = Path("/opt/anaconda3/envs/longerface/bin/python")

FACE_OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
    379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
    234, 127, 162, 21, 54, 103, 67, 109,
]
BROW = [70, 63, 105, 66, 107, 336, 296, 334, 293, 300]
CLASS_ORDER = ("forehead", "glabellar", "nasal_dorsum", "crow_feet")
CLASS_COLORS = {
    "forehead": (28, 159, 255),
    "glabellar": (157, 77, 255),
    "nasal_dorsum": (255, 212, 0),
    "crow_feet": (101, 190, 66),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--yolo-evidence", type=Path, default=DEFAULT_YOLO)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--face-model", type=Path, default=DEFAULT_FACE_MODEL)
    parser.add_argument("--landmark-input", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--unet-threshold", type=float, default=0.50)
    parser.add_argument("--hessian-percentile", type=float, default=99.25)
    parser.add_argument("--landmarks-only", action="store_true")
    parser.add_argument("--landmark-output", type=Path)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def dump_landmarks(input_path: Path, model_path: Path, output_path: Path) -> None:
    import mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision

    image = mp.Image.create_from_file(str(input_path))
    options = vision.FaceLandmarkerOptions(
        base_options=python.BaseOptions(
            model_asset_path=str(model_path),
            delegate=python.BaseOptions.Delegate.CPU,
        ),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
    )
    with vision.FaceLandmarker.create_from_options(options) as detector:
        result = detector.detect(image)
    if len(result.face_landmarks) != 1:
        raise RuntimeError(f"Expected one face, received {len(result.face_landmarks)}")
    payload = {
        "source": str(input_path),
        "sourceSha256": sha256(input_path),
        "landmarks": [[float(point.x), float(point.y), float(point.z)] for point in result.face_landmarks[0]],
    }
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def load_landmarks(
    input_path: Path,
    model_path: Path,
    output_dir: Path,
    landmark_input: Path | None = None,
) -> np.ndarray:
    landmark_path = output_dir / "landmarks.json"
    if landmark_input is None:
        subprocess.run(
            [
                str(LONGERFACE_PYTHON),
                str(Path(__file__).resolve()),
                "--landmarks-only",
                "--input",
                str(input_path),
                "--face-model",
                str(model_path),
                "--landmark-output",
                str(landmark_path),
            ],
            check=True,
        )
        payload = json.loads(landmark_path.read_text(encoding="utf-8"))
    else:
        payload = json.loads(landmark_input.read_text(encoding="utf-8"))
        landmark_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    if payload["sourceSha256"].upper() != sha256(input_path):
        raise RuntimeError("MediaPipe landmark artifact does not match the source image")
    landmarks = np.asarray(payload["landmarks"], dtype=np.float32)
    if landmarks.ndim != 2 or landmarks.shape[0] < 468 or landmarks.shape[1] != 3:
        raise RuntimeError(f"Unexpected MediaPipe landmark shape: {landmarks.shape}")
    return landmarks


def hessian_texture(image_bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    smooth = cv2.GaussianBlur(gray, (0, 0), sigmaX=1.2, sigmaY=1.2)
    ixx = cv2.Sobel(smooth, cv2.CV_32F, 2, 0, ksize=3)
    ixy = cv2.Sobel(smooth, cv2.CV_32F, 1, 1, ksize=3)
    iyy = cv2.Sobel(smooth, cv2.CV_32F, 0, 2, ksize=3)
    trace = ixx + iyy
    delta = np.sqrt(np.maximum((ixx - iyy) ** 2 + 4.0 * ixy * ixy, 0.0))
    first = 0.5 * (trace + delta)
    second = 0.5 * (trace - delta)
    strength = np.maximum(np.abs(first), np.abs(second))
    lo, hi = np.percentile(strength, [2.0, 99.8])
    return np.clip((strength - lo) / max(hi - lo, 1e-6), 0.0, 1.0)


def build_unet(torch):
    nn = torch.nn
    functional = torch.nn.functional

    class DoubleConv(nn.Module):
        def __init__(self, in_channels, out_channels, mid_channels=None):
            super().__init__()
            mid_channels = mid_channels or out_channels
            self.double_conv = nn.Sequential(
                nn.Conv2d(in_channels, mid_channels, kernel_size=3, padding=1, bias=False),
                nn.BatchNorm2d(mid_channels),
                nn.ReLU(inplace=True),
                nn.Conv2d(mid_channels, out_channels, kernel_size=3, padding=1, bias=False),
                nn.BatchNorm2d(out_channels),
                nn.ReLU(inplace=True),
            )

        def forward(self, x):
            return self.double_conv(x)

    class Down(nn.Module):
        def __init__(self, in_channels, out_channels):
            super().__init__()
            self.maxpool_conv = nn.Sequential(nn.MaxPool2d(2), DoubleConv(in_channels, out_channels))

        def forward(self, x):
            return self.maxpool_conv(x)

    class Up(nn.Module):
        def __init__(self, in_channels, out_channels):
            super().__init__()
            self.up = nn.Upsample(scale_factor=2, mode="bilinear", align_corners=True)
            self.conv = DoubleConv(in_channels, out_channels, in_channels // 2)

        def forward(self, x1, x2):
            x1 = self.up(x1)
            diff_y = x2.size()[2] - x1.size()[2]
            diff_x = x2.size()[3] - x1.size()[3]
            x1 = functional.pad(
                x1,
                [diff_x // 2, diff_x - diff_x // 2, diff_y // 2, diff_y - diff_y // 2],
            )
            return self.conv(torch.cat([x2, x1], dim=1))

    class OutConv(nn.Module):
        def __init__(self, in_channels, out_channels):
            super().__init__()
            self.conv = nn.Conv2d(in_channels, out_channels, kernel_size=1)

        def forward(self, x):
            return self.conv(x)

    class UNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.inc = DoubleConv(4, 64)
            self.down1 = Down(64, 128)
            self.down2 = Down(128, 256)
            self.down3 = Down(256, 512)
            self.down4 = Down(512, 512)
            self.up1 = Up(1024, 256)
            self.up2 = Up(512, 128)
            self.up3 = Up(256, 64)
            self.up4 = Up(128, 64)
            self.outc = OutConv(64, 2)

        def forward(self, x):
            x1 = self.inc(x)
            x2 = self.down1(x1)
            x3 = self.down2(x2)
            x4 = self.down3(x3)
            x5 = self.down4(x4)
            x = self.up1(x5, x4)
            x = self.up2(x, x3)
            x = self.up3(x, x2)
            x = self.up4(x, x1)
            return self.outc(x)

    return UNet()


def run_unet(image_bgr: np.ndarray, texture: np.ndarray, checkpoint_path: Path):
    import torch

    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    size = int(checkpoint.get("imgSize", 512))
    model = build_unet(torch)
    state = {key.removeprefix("module."): value for key, value in checkpoint["model"].items()}
    model.load_state_dict(state, strict=True)
    model.eval()
    image = cv2.resize(image_bgr, (size, size), interpolation=cv2.INTER_AREA)
    resized_texture = cv2.resize(texture, (size, size), interpolation=cv2.INTER_AREA)
    rgb = image[:, :, ::-1].astype(np.float32) / 255.0
    rgb = rgb * 2.0 - 1.0
    tex = resized_texture.astype(np.float32) * 2.0 - 1.0
    array = np.concatenate([np.transpose(rgb, (2, 0, 1)), tex[None]], axis=0)
    with torch.inference_mode():
        logits = model(torch.from_numpy(array[None]))
        probability = torch.softmax(logits, dim=1)[0, 1].numpy()
    probability = cv2.resize(
        probability,
        (image_bgr.shape[1], image_bgr.shape[0]),
        interpolation=cv2.INTER_LINEAR,
    )
    metadata = {key: value for key, value in checkpoint.items() if key != "model"}
    return probability.astype(np.float32), metadata


def decode_runs(runs: list[list[int]], width: int, height: int) -> np.ndarray:
    flat = np.zeros(width * height, dtype=np.uint8)
    for start, length in runs:
        flat[int(start):int(start) + int(length)] = 1
    return flat.reshape(height, width)


def load_yolo_evidence(path: Path, source_path: Path, width: int, height: int):
    evidence = json.loads(path.read_text(encoding="utf-8"))
    source = evidence["sourceImage"]
    if source["sha256"].upper() != sha256(source_path):
        raise RuntimeError("Saved YOLO evidence does not match the source image SHA-256")
    if int(source["width"]) != width or int(source["height"]) != height:
        raise RuntimeError("Saved YOLO evidence dimensions do not match the source image")
    masks = evidence["masks"]
    raw = decode_runs(masks["rawYoloStrictUnion"], width, height)
    centerline = decode_runs(masks["centerlineUnion"], width, height)
    classes = {
        name: decode_runs(runs, width, height)
        for name, runs in masks["classes"].items()
    }
    return evidence, raw, centerline, classes


def component_filter(mask: np.ndarray, minimum_pixels: int, minimum_span: int) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    output = np.zeros_like(mask, dtype=np.uint8)
    for label in range(1, count):
        x, y, width, height, area = stats[label]
        if int(area) < minimum_pixels or max(int(width), int(height)) < minimum_span:
            continue
        output[labels == label] = 1
    return output


def morphological_skeleton(mask: np.ndarray) -> np.ndarray:
    source = (mask.astype(np.uint8) * 255).copy()
    skeleton = np.zeros_like(source)
    kernel = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
    while cv2.countNonZero(source):
        eroded = cv2.erode(source, kernel)
        opened = cv2.dilate(eroded, kernel)
        skeleton = cv2.bitwise_or(skeleton, cv2.subtract(source, opened))
        source = eroded
    return (skeleton > 0).astype(np.uint8)


def pixel_landmarks(normalized: np.ndarray, width: int, height: int) -> np.ndarray:
    output = normalized.copy()
    output[:, 0] *= width
    output[:, 1] *= height
    output[:, 2] *= width
    return output


def anatomy_regions(landmarks: np.ndarray, width: int, height: int):
    points = pixel_landmarks(landmarks, width, height)
    face = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(face, [np.round(points[FACE_OVAL, :2]).astype(np.int32)], 1)
    left_face_x = float(min(points[234, 0], points[454, 0]))
    right_face_x = float(max(points[234, 0], points[454, 0]))
    face_width = right_face_x - left_face_x
    center_x = float(points[168, 0])
    brow_y = float(np.mean(points[BROW, 1]))
    top_y = float(points[10, 1])
    nose_root_y = float(points[168, 1])
    nose_tip_y = float(points[1, 1])
    eye_points = sorted(
        [(float(points[33, 0]), float(points[33, 1])), (float(points[263, 0]), float(points[263, 1]))],
    )

    regions = {name: np.zeros((height, width), dtype=np.uint8) for name in CLASS_ORDER}
    forehead_box = np.zeros_like(face)
    cv2.rectangle(
        forehead_box,
        (int(left_face_x + 0.06 * face_width), int(top_y + 0.015 * face_width)),
        (int(right_face_x - 0.06 * face_width), int(brow_y - 0.018 * face_width)),
        1,
        -1,
    )
    regions["forehead"] = forehead_box & face

    glabella = np.zeros_like(face)
    cv2.ellipse(
        glabella,
        (int(center_x), int((brow_y + nose_root_y) * 0.5)),
        (int(0.115 * face_width), int(max(0.085 * face_width, (nose_root_y - brow_y) * 0.75))),
        0,
        0,
        360,
        1,
        -1,
    )
    regions["glabellar"] = glabella & face

    nasal = np.zeros_like(face)
    nasal_bottom = min(nose_tip_y - 0.035 * face_width, nose_root_y + 0.31 * face_width)
    nasal_polygon = np.array(
        [
            [center_x - 0.14 * face_width, nose_root_y - 0.015 * face_width],
            [center_x + 0.14 * face_width, nose_root_y - 0.015 * face_width],
            [center_x + 0.105 * face_width, nasal_bottom],
            [center_x - 0.105 * face_width, nasal_bottom],
        ],
        dtype=np.int32,
    )
    cv2.fillPoly(nasal, [nasal_polygon], 1)
    regions["nasal_dorsum"] = nasal & face

    crow = np.zeros_like(face)
    for index, (outer_x, outer_y) in enumerate(eye_points):
        direction = -1 if index == 0 else 1
        center = (int(outer_x + direction * 0.10 * face_width), int(outer_y + 0.02 * face_width))
        current = np.zeros_like(face)
        cv2.ellipse(
            current,
            center,
            (int(0.19 * face_width), int(0.17 * face_width)),
            0,
            0,
            360,
            1,
            -1,
        )
        if direction < 0:
            current[:, int(outer_x + 0.01 * face_width):] = 0
        else:
            current[:, :int(outer_x - 0.01 * face_width)] = 0
        crow |= current
    regions["crow_feet"] = crow & face

    regions["forehead"] &= ~regions["glabellar"]
    regions["glabellar"] &= ~regions["nasal_dorsum"]
    return regions, face, {
        "faceWidthPx": face_width,
        "centerX": center_x,
        "browY": brow_y,
        "topY": top_y,
        "noseRootY": nose_root_y,
        "noseTipY": nose_tip_y,
        "outerCanthi": eye_points,
    }


def overlay_mask(image: np.ndarray, mask: np.ndarray, color, alpha: float) -> np.ndarray:
    output = image.copy()
    color_layer = np.zeros_like(image)
    color_layer[:] = color
    selected = mask.astype(bool)
    output[selected] = cv2.addWeighted(image, 1.0 - alpha, color_layer, alpha, 0)[selected]
    return output


def draw_skeleton(image: np.ndarray, skeleton: np.ndarray, color, thickness: int = 2) -> np.ndarray:
    radius = max(0, thickness - 1)
    visible = skeleton.astype(np.uint8)
    if radius:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
        visible = cv2.dilate(visible, kernel)
    return overlay_mask(image, visible, color, 0.96)


def label_panel(image: np.ndarray, label: str) -> np.ndarray:
    panel = cv2.copyMakeBorder(image, 48, 0, 0, 0, cv2.BORDER_CONSTANT, value=(14, 18, 24))
    cv2.putText(panel, label, (18, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.74, (238, 242, 247), 2, cv2.LINE_AA)
    return panel


def montage(items: list[tuple[str, np.ndarray]], width: int = 520) -> np.ndarray:
    panels = []
    for label, image in items:
        scale = width / image.shape[1]
        resized = cv2.resize(image, (width, round(image.shape[0] * scale)), interpolation=cv2.INTER_AREA)
        panels.append(label_panel(resized, label))
    rows = []
    for start in range(0, len(panels), 3):
        row = panels[start:start + 3]
        while len(row) < 3:
            row.append(np.zeros_like(panels[0]))
        rows.append(cv2.hconcat(row))
    return cv2.vconcat(rows)


def save(path: Path, image: np.ndarray) -> None:
    if not cv2.imwrite(str(path), image):
        raise RuntimeError(f"Failed to write {path}")


def mask_summary(mask: np.ndarray) -> dict[str, int]:
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    components = int(sum(1 for label in range(1, count) if stats[label, cv2.CC_STAT_AREA] > 0))
    return {"pixels": int(mask.sum()), "components": components}


def run(args: argparse.Namespace) -> None:
    if args.output.exists():
        raise FileExistsError(f"Refusing to overwrite existing output directory: {args.output}")
    args.output.mkdir(parents=True)
    image = cv2.imread(str(args.input), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(args.input)
    height, width = image.shape[:2]
    source_hash = sha256(args.input)
    landmarks = load_landmarks(
        args.input,
        args.face_model,
        args.output,
        args.landmark_input,
    )
    regions, face_mask, anatomy = anatomy_regions(landmarks, width, height)

    yolo, yolo_raw, yolo_centerline, yolo_classes = load_yolo_evidence(
        args.yolo_evidence,
        args.input,
        width,
        height,
    )
    texture = hessian_texture(image)
    unet_probability, checkpoint_metadata = run_unet(image, texture, args.checkpoint)
    region_union = np.zeros((height, width), dtype=np.uint8)
    for mask in regions.values():
        region_union |= mask

    unet_mask = ((unet_probability >= args.unet_threshold) & (region_union > 0)).astype(np.uint8)
    unet_mask = component_filter(unet_mask, minimum_pixels=6, minimum_span=8)
    unet_skeleton = component_filter(
        morphological_skeleton(unet_mask),
        minimum_pixels=5,
        minimum_span=8,
    )

    candidate_values = texture[region_union > 0]
    hessian_cutoff = float(np.percentile(candidate_values, args.hessian_percentile))
    hessian_mask = ((texture >= hessian_cutoff) & (region_union > 0)).astype(np.uint8)
    hessian_mask = component_filter(hessian_mask, minimum_pixels=5, minimum_span=9)
    hessian_skeleton = component_filter(
        morphological_skeleton(hessian_mask),
        minimum_pixels=4,
        minimum_span=8,
    )

    yolo_skeleton = (yolo_centerline & region_union).astype(np.uint8)
    model_union = (unet_skeleton | yolo_skeleton).astype(np.uint8)
    support_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    unet_support = cv2.dilate(unet_skeleton, support_kernel)
    yolo_support = cv2.dilate(yolo_skeleton, support_kernel)
    high = ((unet_skeleton & yolo_support) | (yolo_skeleton & unet_support)).astype(np.uint8)
    high_support = cv2.dilate(high, support_kernel)
    medium = (model_union & ~high_support.astype(bool)).astype(np.uint8)
    model_support = cv2.dilate(model_union, support_kernel)
    low = (hessian_skeleton & ~model_support.astype(bool)).astype(np.uint8)
    fused = (high | medium | low).astype(np.uint8)

    input_output = image.copy()
    yolo_output = overlay_mask(image, yolo_raw, (255, 128, 0), 0.32)
    yolo_output = draw_skeleton(yolo_output, yolo_skeleton, (255, 212, 0), 2)
    heatmap = cv2.applyColorMap(np.clip(unet_probability * 255, 0, 255).astype(np.uint8), cv2.COLORMAP_TURBO)
    probability_output = cv2.addWeighted(image, 0.45, heatmap, 0.55, 0)
    unet_output = overlay_mask(image, unet_mask, (70, 70, 255), 0.30)
    unet_output = draw_skeleton(unet_output, unet_skeleton, (157, 77, 255), 2)
    hessian_output = cv2.applyColorMap(np.clip(texture * 255, 0, 255).astype(np.uint8), cv2.COLORMAP_BONE)
    hessian_output = cv2.addWeighted(image, 0.55, hessian_output, 0.45, 0)
    hessian_output = draw_skeleton(hessian_output, hessian_skeleton, (0, 215, 255), 1)
    fused_output = image.copy()
    fused_output = draw_skeleton(fused_output, low, (160, 160, 160), 1)
    fused_output = draw_skeleton(fused_output, medium, (0, 200, 255), 2)
    fused_output = draw_skeleton(fused_output, high, (80, 255, 80), 2)

    classified_output = image.copy()
    classified_masks = {}
    for name in CLASS_ORDER:
        current = (fused & regions[name]).astype(np.uint8)
        classified_masks[name] = current
        classified_output = draw_skeleton(classified_output, current & low, CLASS_COLORS[name], 1)
        classified_output = draw_skeleton(
            classified_output,
            current & (high | medium),
            CLASS_COLORS[name],
            2,
        )

    region_output = image.copy()
    for name in CLASS_ORDER:
        region_output = overlay_mask(region_output, regions[name], CLASS_COLORS[name], 0.20)
        contours, _ = cv2.findContours(regions[name], cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(region_output, contours, -1, CLASS_COLORS[name], 2, cv2.LINE_AA)
    for index, name in enumerate(CLASS_ORDER):
        cv2.putText(
            region_output,
            name,
            (26, 38 + index * 34),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.72,
            CLASS_COLORS[name],
            2,
            cv2.LINE_AA,
        )

    save(args.output / "00_input.png", input_output)
    save(args.output / "01_current_yolo.png", yolo_output)
    save(args.output / "02_unet_probability.png", probability_output)
    save(args.output / "03_unet_wrinkles.png", unet_output)
    save(args.output / "04_hessian_candidates.png", hessian_output)
    save(args.output / "05_fused_wrinkles.png", fused_output)
    save(args.output / "06_four_class_overlay.png", classified_output)
    save(args.output / "07_four_class_regions.png", region_output)
    comparison = montage(
        [
            ("Input", input_output),
            ("Current YOLO", yolo_output),
            ("U-Net probability", probability_output),
            ("U-Net mask", unet_output),
            ("Hessian candidates", hessian_output),
            ("Fused confidence", fused_output),
            ("Four-class overlay", classified_output),
            ("Anatomical regions", region_output),
        ],
    )
    save(args.output / "08_comparison_montage.png", comparison)

    diagnostics = {
        "schemaVersion": "langerface.wrinkle-four-class-experiment.v1",
        "validated": False,
        "trainingPerformed": False,
        "rstlModified": False,
        "source": {
            "path": str(args.input),
            "sha256": source_hash,
            "width": width,
            "height": height,
        },
        "yolo": {
            "evidencePath": str(args.yolo_evidence),
            "model": yolo["model"],
            "diagnostics": yolo["diagnostics"],
            "rawMask": mask_summary(yolo_raw),
            "centerline": mask_summary(yolo_skeleton),
            "sourceClassPixels": {name: int(mask.sum()) for name, mask in yolo_classes.items()},
        },
        "unet": {
            "checkpoint": str(args.checkpoint),
            "checkpointSha256": sha256(args.checkpoint),
            "metadata": checkpoint_metadata,
            "threshold": args.unet_threshold,
            "probability": {
                "minimum": float(unet_probability.min()),
                "maximum": float(unet_probability.max()),
                "meanInRegions": float(unet_probability[region_union > 0].mean()),
                "p95InRegions": float(np.percentile(unet_probability[region_union > 0], 95)),
                "p99InRegions": float(np.percentile(unet_probability[region_union > 0], 99)),
            },
            "mask": mask_summary(unet_mask),
            "centerline": mask_summary(unet_skeleton),
        },
        "hessian": {
            "algorithm": "absolute_hessian_eigenvalue_ridge_strength",
            "percentile": args.hessian_percentile,
            "cutoff": hessian_cutoff,
            "candidateMask": mask_summary(hessian_mask),
            "centerline": mask_summary(hessian_skeleton),
        },
        "fusion": {
            "highConfidence": mask_summary(high),
            "mediumConfidence": mask_summary(medium),
            "lowConfidence": mask_summary(low),
            "combined": mask_summary(fused),
            "policy": "model agreement high; single learned model medium; Hessian-only low",
        },
        "classification": {
            "method": "MediaPipe landmark-derived non-trained anatomical ROIs",
            "anatomy": anatomy,
            "classes": {
                name: {
                    "colorBgr": CLASS_COLORS[name],
                    "regionPixels": int(regions[name].sum()),
                    "wrinkle": mask_summary(classified_masks[name]),
                }
                for name in CLASS_ORDER
            },
        },
        "limitations": [
            "No four-class ground truth is available; classification is anatomical, not learned.",
            "Hessian-only candidates are deliberately low confidence and may include texture or shadows.",
            "The saved YOLO evidence is reused only after exact source SHA-256 and dimensions match.",
            "This experiment does not assess or alter RSTL refinement.",
        ],
    }
    (args.output / "diagnostics.json").write_text(
        json.dumps(diagnostics, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "output": str(args.output),
        "yoloCenterlinePixels": int(yolo_skeleton.sum()),
        "unetCenterlinePixels": int(unet_skeleton.sum()),
        "hessianLowConfidencePixels": int(low.sum()),
        "classPixels": {name: int(mask.sum()) for name, mask in classified_masks.items()},
    }, indent=2, ensure_ascii=False))


def main() -> int:
    args = parse_args()
    if args.landmarks_only:
        if args.landmark_output is None:
            raise SystemExit("--landmark-output is required with --landmarks-only")
        dump_landmarks(args.input, args.face_model, args.landmark_output)
        return 0
    run(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
