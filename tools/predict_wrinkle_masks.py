"""Predict wrinkle masks with a trained TinyDexiNed checkpoint."""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

from train_wrinkle_edge_model import make_tiny_dexined

REPO = Path(__file__).resolve().parents[1]
DEFAULT_CHECKPOINT = REPO / "local_outputs" / "wrinkle_edge_model.pth"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}


def main() -> int:
    args = _parse_args()
    try:
        import torch
        import torch.nn as nn
        import torch.nn.functional as F
    except ImportError as exc:
        raise SystemExit("PyTorch is required for wrinkle mask prediction.") from exc

    device = torch.device("cuda" if torch.cuda.is_available() and not args.cpu else "cpu")
    checkpoint = torch.load(args.checkpoint, map_location=device)
    img_size = int(checkpoint.get("imgSize", args.img_size))
    model = make_tiny_dexined(nn, F, torch).to(device)
    model.load_state_dict(checkpoint["model"])
    model.eval()

    inputs = _input_files(args.input)
    args.out.mkdir(parents=True, exist_ok=True)
    with torch.inference_mode():
        for path in inputs:
            original = cv2.imread(str(path), cv2.IMREAD_COLOR)
            if original is None:
                print(f"[skip] unreadable {path}")
                continue
            image = cv2.resize(original, (img_size, img_size), interpolation=cv2.INTER_AREA)
            image = image[:, :, ::-1].astype(np.float32) / 255.0
            tensor = torch.from_numpy(np.transpose(image, (2, 0, 1))[None]).to(device)
            logits = model(tensor)[-1]
            prob = torch.sigmoid(logits)[0, 0].cpu().numpy()
            prob = cv2.resize(prob, (original.shape[1], original.shape[0]), interpolation=cv2.INTER_LINEAR)
            mask = (prob >= args.threshold).astype(np.uint8) * 255
            out_path = args.out / f"{path.stem}_wrinkle_mask.png"
            cv2.imwrite(str(out_path), mask)
            print(f"[ok] {out_path}")
    return 0


def _input_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    if path.is_dir():
        return sorted(p for p in path.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTS)
    raise FileNotFoundError(path)


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    ap.add_argument("--input", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=REPO / "local_outputs" / "wrinkle_masks")
    ap.add_argument("--img-size", type=int, default=256)
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--cpu", action="store_true")
    return ap.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
